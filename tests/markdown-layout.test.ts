import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from '@/components/Markdown'
import { lineAtOffset, pickScrollTop } from '@/lib/client/markdown'

// ============================================================================
// Markdown 布局与滚动守卫（2026-09-30）
//
// 三件事各守一段：
//   W —— 正文里的长网址 / 长英文串 / 连续无空格字符不得撑破容器（否则整个页面出横向滚动条）；
//   S —— 编辑态切到预览态时，预览的滚动位置要跟着编辑光标走，且边界情况正确；
//   S2 —— 上面那条的**输入**（渲染产物里的行号锚点 data-qo-line）必须真的存在。
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

// ============================================================================
// S2 · 渲染产物里的行号锚点（上面那套定位逻辑的输入）
//
// 为什么必须有这一段：S 里那几条全是**纯函数**测试，它们全绿也不能说明功能可用。
// 2026-09-30 的真实故障——react-markdown 只在使用**默认渲染**时才把节点属性落到 DOM 上，
// 一旦用 components 接管了标签，属性就只送到自定义组件为止；而顶层块（p / h1-h3 / ul /
// ol / blockquote / hr，以及围栏代码块的内层 code）**全部**被本项目接管，
// 于是 data-qo-line 一个都没进 DOM ⇒ querySelectorAll 空 ⇒ pickScrollTop 恒返回 0
// ⇒ 预览永远从顶部开始（用户反馈「预览滚动还是不对」）。
// 所以这里不再做源码文本断言，而是把组件**真的渲染成 HTML**，逐块核对锚点。
// ============================================================================
describe('S2 · 渲染产物里的行号锚点（预览滚动定位的输入）', () => {
  // 行号即下方数组下标 +1（每类块之间用空行隔开，行号好核对）
  const source = [
    '# 一级', // 1
    '', // 2
    '段落一', // 3
    '', // 4
    '## 二级', // 5
    '', // 6
    '- 甲', // 7
    '- 乙', // 8
    '', // 9
    '> 引用', // 10
    '', // 11
    '```js', // 12
    'const a = 1', // 13
    '```', // 14
    '', // 15
    '---', // 16
    '', // 17
    '尾段', // 18
  ].join('\n')
  const out = renderToStaticMarkup(createElement(Markdown, { source }))
  const anchors = [...out.matchAll(/data-qo-line="(\d+)"/g)].map((m) => Number(m[1]))

  it('S2.0 非空转自检：产物里确实渲染出了这些块', () => {
    for (const tag of ['<h1', '<h2', '<p', '<ul', '<blockquote', '<pre', '<hr', '<code']) {
      expect(out, `产物里没有 ${tag}，后面的锚点断言会变成空转`).toContain(tag)
    }
  })

  it('S2.1 每个顶层块都带锚点，行号与源码一致、且按文档顺序排列', () => {
    // pickScrollTop 依赖「按源码顺序给出」——顺序错了它会静默取错块，所以这里连顺序一起钉住
    expect(anchors).toEqual([1, 3, 5, 7, 10, 12, 16, 18])
  })

  it('S2.2 逐类核对：锚点落在该块自己的元素上（含围栏代码块的内层 code）', () => {
    expect(out, 'h1 没带锚点').toMatch(/<h1[^>]*data-qo-line="1"/)
    expect(out, '段落没带锚点').toMatch(/<p[^>]*data-qo-line="3"/)
    expect(out, 'h2 没带锚点').toMatch(/<h2[^>]*data-qo-line="5"/)
    expect(out, '列表没带锚点').toMatch(/<ul[^>]*data-qo-line="7"/)
    expect(out, '引用没带锚点').toMatch(/<blockquote[^>]*data-qo-line="10"/)
    // mdast-util-to-hast 把 hProperties 应用在 code 上而不是外层 pre（实测），所以锚点在 code
    expect(out, '代码块没带锚点（锚点在内层 code 上）').toMatch(/<code[^>]*data-qo-line="12"/)
    expect(out, '分隔线没带锚点').toMatch(/<hr[^>]*data-qo-line="16"/)
    expect(out, '最后一段没带锚点').toMatch(/<p[^>]*data-qo-line="18"/)
  })

  it('S2.3 node 不得落到真实元素上（它是 hast 节点对象，不是 DOM 属性）', () => {
    // 用「整体 spread」转发属性时会踩到：React 把它序列化成 node="[object Object]"
    expect(out).not.toMatch(/\snode="/)
  })

  it('S2.4 行内 / 嵌套元素不带锚点（锚点只属于顶层块，否则顺序语义就不成立了）', () => {
    for (const tag of ['li', 'strong', 'em', 'a']) {
      expect(out, `<${tag}> 不该带锚点`).not.toMatch(new RegExp(`<${tag}[^>]*data-qo-line`))
    }
  })

  it('S2.5 行内代码的样式不被语言标记覆盖（转发属性时只放 data-*）', () => {
    // fenced code 的内层 code 带 className="language-js"，整体 spread 会把它接上来盖掉自己的样式
    const codeTag = out.match(/<code[^>]*>/)?.[0] ?? ''
    expect(codeTag, '解析不到 code 开始标签').toContain('data-qo-line')
    expect(codeTag, 'code 的 className 被语言标记覆盖了').not.toContain('language-js')
  })
})

// ============================================================================
// S3 · 两处编辑态共用同一套接线（防再次「只长在写页上」）
//
// 上一次的 bug 是详情页编辑态整条工具条缺失；这次的 bug 是两份实现漂移的另一种表现。
// 契约有三条：都用同一个 hook、都渲染同一根横条、previewRef 都挂在预览容器上。
// ============================================================================
describe('S3 · 写页与详情页编辑态共用同一套 Markdown 接线', () => {
  for (const file of ['components/DiaryEditor.tsx', 'components/EntryView.tsx']) {
    const src = code(file)

    it(`S3 ${file}：用共享 hook`, () => {
      expect(src, '没有接 useMarkdownEditor（说明自己另写了一份）').toContain('useMarkdownEditor(')
    })

    it(`S3 ${file}：渲染同一根工具条，并把切换按钮接上`, () => {
      expect(src, '没有渲染 MarkdownToolbar').toContain('<MarkdownToolbar')
      expect(src, '工具条没有接 onTogglePreview').toContain('onTogglePreview={togglePreview}')
    })

    it(`S3 ${file}：previewRef 挂在预览容器上`, () => {
      expect(src, 'previewRef 没挂到预览容器（定位会读错节点几何）').toContain('ref={previewRef}')
    })
  }
})
