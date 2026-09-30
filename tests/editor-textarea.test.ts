// 守卫：正文编辑区的字号必须与查看页一致（「所见即所得」的排版前提）。
//
// 背景（2026-09-30 用户指出）：写页的输入框写着 `text-lg`（18px），而查看页的 Markdown
// 容器（components/Markdown.tsx 的 qo-markdown）与详情页编辑态都是 `text-base`（16px）。
// 同一段文字「写」的时候比「看」的时候大一号 ⇒ 行宽不同、换行位置不同 ⇒ 用户按下保存前
// 看到的排版和保存后看到的不是一回事。
//
// 修法：抽 `EDITOR_TEXTAREA_CLASS`（lib/client/ui.ts）作为写页 AutoTextarea 与详情页
// 编辑态 EntryView 的**唯一来源**，字号钉在 text-base，与查看页容器同源。
//
// 为什么判定不写成「全仓 grep text-lg」：合法的 text-lg 还有一批——页面 <h1> 标题、
// 列表行的 `›` 箭头、头像首字母、Markdown 的 h3（24/20/18 阶梯的一部分）。一刀切会把
// 它们全部打红。所以这里把判定**锚在「class 里同时有 resize-none 的编辑输入框」**上，
// 只约束真正需要与查看页对齐的那几处。
//
// 断言前一律剥离注释：本文件与源码里的说明都会出现 `text-lg` 字样，不剥的话
// E2 会被自己的文档打红（page-transition.test.ts / footnote-contrast.test.ts 同款做法）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classAttrsIn, classTokens, projectClassAttrs, projectRoot, stripComments } from './class-attrs'

function code(rel: string): string {
  return stripComments(readFileSync(join(projectRoot, rel), 'utf8'))
}

/** 取属性里真正影响字号的 token（含 sm: / dark: 这类变体前缀也算） */
function fontSizeTokens(attr: string): string[] {
  return classTokens(attr).filter((t) => /(^|:)text-(xs|sm|base|lg|xl|\dxl)$/.test(t))
}

// 两处编辑输入框：写页（AutoTextarea）与详情页编辑态（EntryView）的裸 <textarea>。
const EDITORS = ['components/AutoTextarea.tsx', 'components/EntryView.tsx']

describe('E · 编辑区字号与查看页同源', () => {
  it('E0 解析自检：常量已被展开成真实 class 串（否则后面全是空转）', () => {
    const src = code('components/AutoTextarea.tsx')
    const expanded = classAttrsIn('components/AutoTextarea.tsx', src).find((a) =>
      a.text.includes('resize-none'),
    )
    expect(expanded, '解析出的 class 属性里没有 resize-none —— 解析器没工作').toBeDefined()
    // 源文里写的是标识符，解析结果里必须已经变成真实 class 串（resize-none 只可能来自常量）。
    // 注意别在这里断言 text-base：那是 E2/E4 的职责，写在这里会让「自检」与「业务断言」纠缠。
    expect(src, '源文里其实没有引用常量').toContain('EDITOR_TEXTAREA_CLASS')
    expect(
      expanded!.text,
      'className 里的 EDITOR_TEXTAREA_CLASS 没有被展开 —— 「按 token 找字号」会静默空转',
    ).not.toContain('EDITOR_TEXTAREA_CLASS')
  })

  it.each(EDITORS)('E1 %s 的输入框引用共享常量，不自己写字号', (file) => {
    const src = code(file)
    expect(
      src,
      `${file} 没有引用 EDITOR_TEXTAREA_CLASS —— 字号又散在组件里写了，下次必然再漂移`,
    ).toContain('EDITOR_TEXTAREA_CLASS')
    expect(src, `${file} 没有从 '@/lib/client/ui' 引常量`).toContain("from '@/lib/client/ui'")
  })

  it('E2 所有编辑输入框一律 text-base，禁止 text-lg（与查看页 qo-markdown 一致）', () => {
    const found = projectClassAttrs().filter((a) => a.text.includes('resize-none'))
    expect(
      found.length,
      '一个 resize-none 的编辑输入框都没扫到 —— 断言会空转（先确认 E0 的解析是否正常）',
    ).toBeGreaterThanOrEqual(2)
    for (const a of found) {
      const sizes = fontSizeTokens(a.text)
      expect(sizes, `${a.file}:${a.line} 输入框没有字号 token`).toContain('text-base')
      expect(
        sizes,
        `${a.file}:${a.line} 输入框用了 text-lg（18px）—— 写页会比查看页大一号，
        同一段文字的换行位置两边对不上。字号只能来自 EDITOR_TEXTAREA_CLASS。`,
      ).not.toContain('text-lg')
    }
  })

  it('E3 查看页容器也是 text-base（两端同源才对得上）', () => {
    const attrs = classAttrsIn('components/Markdown.tsx', code('components/Markdown.tsx'))
      .filter((a) => a.text.includes('qo-markdown'))
    expect(attrs.length, '找不到 qo-markdown 容器 —— 断言会空转').toBeGreaterThan(0)
    for (const a of attrs) {
      expect(
        fontSizeTokens(a.text),
        `${a.file}:${a.line} 查看页容器不是 text-base —— 编辑区必须跟着它走`,
      ).toContain('text-base')
    }
  })

  it('E4 常量本身：text-base + leading-relaxed，不含 text-lg', () => {
    const src = readFileSync(join(projectRoot, 'lib/client/ui.ts'), 'utf8')
    const m = src.match(/export const EDITOR_TEXTAREA_CLASS\s*=\s*'([^']*)'/)
    expect(m, 'lib/client/ui.ts 里找不到 EDITOR_TEXTAREA_CLASS 的单引号常量定义').not.toBeNull()
    const tokens = classTokens(m![1] as string)
    expect(tokens).toContain('text-base')
    expect(tokens).toContain('leading-relaxed')
    expect(tokens).not.toContain('text-lg')
    // 弹性的三个必备项：父级是 flex 容器（写页 flex-col、详情页也是 flex-col）
    for (const t of ['min-h-0', 'w-full', 'flex-1']) expect(tokens, `常量缺少 ${t}`).toContain(t)
  })
})
