import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lineAtOffset, pickScrollTop } from '@/lib/client/markdown'

// ============================================================================
// Markdown 布局与滚动守卫（2026-09-30）
//
// 两件事各守一半：
//   W —— 正文里的长网址 / 长英文串 / 连续无空格字符不得撑破容器（否则整个页面出横向滚动条）；
//   S —— 编辑态切到预览态时，预览的滚动位置要跟着编辑光标走，且边界情况正确。
// ============================================================================

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

function read(rel: string): string {
  return readFileSync(join(projectRoot, rel), 'utf8')
}

// 断言前一律剥离注释：否则「不要用 overflow-x-hidden」这类说明文字本身就会把断言打红，
// 而反过来（"必须包含 X"）也会被注释里的字样喂成假通过。
// 项目里 footnote-contrast.test.ts 踩过同一个坑，处理方式保持一致。
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('W · 长串换行（防横向溢出）', () => {
  const src = code('components/Markdown.tsx')

  it('W0 解析自检：能取到容器与 pre 的 className（防空转）', () => {
    expect(src.length).toBeGreaterThan(1000)
    expect(src, '找不到 qo-markdown 容器').toContain('qo-markdown')
    expect(src, '找不到 pre 的 className').toMatch(/<pre\s+className="/)
  })

  it('W1 容器带 break-words（长 URL 才有断点）', () => {
    // 容器是模板字符串：`qo-markdown … break-words ${className}`
    const m = src.match(/qo-markdown([^`]*)/)
    expect(m, '解析不到容器 className').not.toBeNull()
    expect(
      m![1],
      '容器缺 break-words —— 连续无空格的西文串（长网址 / base64 / 长英文）在 CSS 默认规则下没有任何断点，会撑破容器',
    ).toContain('break-words')
  })

  it('W2 pre 重置为 break-normal（代码块保留自身横向滚动，不被强制断行）', () => {
    const m = src.match(/<pre\s+className="([^"]+)"/)
    expect(m, '解析不到 pre 的 className').not.toBeNull()
    expect(
      m![1],
      'pre 必须把继承下来的 overflow-wrap 重置为 normal：代码块要保持源码原样换行 + overflow-x-auto 自身滚动',
    ).toContain('break-normal')
  })

  it('W3 不用 overflow-x-hidden 兜底（那会把根因藏起来）', () => {
    // 用 hidden 掩盖溢出的代价是：以后任何别的东西撑破容器都不再看得见。
    for (const f of ['components/Markdown.tsx', 'components/EntryView.tsx', 'components/DiaryEditor.tsx']) {
      expect(code(f), `${f} 不应靠 overflow-x-hidden 掩盖溢出`).not.toContain('overflow-x-hidden')
    }
  })

  it('W4 断行策略是 break-words 而不是 break-all', () => {
    // break-all 会在任意位置硬断，把正常英文单词从中间切开；break-word 只在整串放不下时断。
    const m = src.match(/qo-markdown([^`]*)/)
    expect(m![1]).not.toContain('break-all')
  })
})

describe('S · 预览滚动定位（纯函数）', () => {
  describe('lineAtOffset：光标偏移 → 行号', () => {
    it('偏移 0 / 空串 → 第 1 行', () => {
      expect(lineAtOffset('', 0)).toBe(1)
      expect(lineAtOffset('abc', 0)).toBe(1)
    })

    it('只在 \\n 之后进下一行（光标停在换行符之前仍属上一行）', () => {
      const s = 'a\nb'
      expect(lineAtOffset(s, 1)).toBe(1)
      expect(lineAtOffset(s, 2)).toBe(2)
      expect(lineAtOffset(s, 3)).toBe(2)
    })

    it('CRLF 里的 \\r 不算换行', () => {
      expect(lineAtOffset('a\r\nb', 2)).toBe(1)
      expect(lineAtOffset('a\r\nb', 3)).toBe(2)
    })

    it('多行 / 末尾 / 越界都按边界钳制', () => {
      const s = '1\n2\n3\n4'
      expect(lineAtOffset(s, s.length)).toBe(4)
      expect(lineAtOffset(s, 9999)).toBe(4)
      expect(lineAtOffset(s, -5)).toBe(1)
    })

    it('与源码逐行一致（每行起始偏移都应指向该行）', () => {
      const s = '第一行\n\n第三行\n第四行'
      // 第 1 行起始 = 0；第 2 行起始 = 4；第 4 行起始 = 9
      expect(lineAtOffset(s, 0)).toBe(1)
      expect(lineAtOffset(s, 4)).toBe(2)
      expect(lineAtOffset(s, 9)).toBe(4)
    })
  })

  describe('pickScrollTop：选滚动目标', () => {
    const blocks = [
      { line: 1, top: 0 },
      { line: 3, top: 120 },
      { line: 8, top: 400 },
    ]

    it('光标正好落在某块起始行 → 取该块', () => {
      expect(pickScrollTop(blocks, 3)).toBe(120)
      expect(pickScrollTop(blocks, 8)).toBe(400)
    })

    it('光标在某块内部（行号落在两块之间）→ 取上方的块', () => {
      expect(pickScrollTop(blocks, 5)).toBe(120)
    })

    it('边界：光标在第一个块之前 → 取第一块（顶部）', () => {
      expect(pickScrollTop(blocks, 0)).toBe(0)
      expect(pickScrollTop(blocks, 1)).toBe(0)
    })

    it('边界：光标在最后一块之后 → 取最后一块（越界由浏览器钳到最大 scrollTop）', () => {
      expect(pickScrollTop(blocks, 999)).toBe(400)
    })

    it('空列表 → 0（空文档：预览只有占位文案，没有 data-qo-line）', () => {
      expect(pickScrollTop([], 5)).toBe(0)
    })
  })
})
