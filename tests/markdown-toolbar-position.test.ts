// 守卫：Markdown 工具条必须在**编辑区顶部**（输入框/预览区之上）。
//
// 背景（2026-09-30 用户反馈）：手机上输入时键盘从底部弹出，会把输入框下方的工具条整个盖住，
// 「预览 / 插入标记」等于不可用。工具条移到编辑区顶部后，键盘只影响下半屏，
// 横条始终露在键盘之上；桌面端位置同理（页头之下、正文之上），两页一致。
//
// 判定方式：源码里 `<MarkdownToolbar` 必须出现在输入框与预览容器**之前**。
// 这里一律先断言下标 >= 0 再比大小——`indexOf` 未命中返回 -1，而 `-1 < 正数` 恒真，
// 不做这步的话「目标被删掉」时断言反而会通过（本项目踩过这个坑，见 MEMORY.md）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classAttrsIn, classTokens, projectRoot, stripComments } from './class-attrs'

function code(rel: string): string {
  return stripComments(readFileSync(join(projectRoot, rel), 'utf8'))
}

// 两处编辑页：写页（DiaryEditor）与详情页编辑态（EntryView）
const EDITORS = [
  { file: 'components/DiaryEditor.tsx', editorAnchor: '<AutoTextarea' },
  { file: 'components/EntryView.tsx', editorAnchor: '<textarea' },
] as const

describe('T · Markdown 工具条位置', () => {
  it('T0 解析自检：两页都读到了工具条与编辑区锚点（防断言空转）', () => {
    for (const { file, editorAnchor } of EDITORS) {
      const src = code(file)
      expect(src.length, `${file} 读不到内容`).toBeGreaterThan(500)
      expect(src, `${file} 里找不到 <MarkdownToolbar`).toContain('<MarkdownToolbar')
      expect(src, `${file} 里找不到编辑区锚点 ${editorAnchor}`).toContain(editorAnchor)
      expect(src, `${file} 里找不到预览容器 ref={previewRef}`).toContain('ref={previewRef}')
    }
  })

  it.each(EDITORS)('T1 %s 的工具条在输入框之前（键盘盖不到）', ({ file, editorAnchor }) => {
    const src = code(file)
    const toolbar = src.indexOf('<MarkdownToolbar')
    const editor = src.indexOf(editorAnchor)
    expect(toolbar, '找不到 <MarkdownToolbar，后面的比较会空转').toBeGreaterThanOrEqual(0)
    expect(editor, `找不到 ${editorAnchor}，后面的比较会空转`).toBeGreaterThanOrEqual(0)
    expect(
      toolbar,
      '工具条又跑到输入框下面去了 —— 手机输入时键盘会把它整条盖住，按钮点不到',
    ).toBeLessThan(editor)
  })

  it.each(EDITORS)('T2 %s 的工具条在预览容器之前（预览态同样露在键盘之上）', ({ file }) => {
    const src = code(file)
    const toolbar = src.indexOf('<MarkdownToolbar')
    const preview = src.indexOf('ref={previewRef}')
    expect(toolbar).toBeGreaterThanOrEqual(0)
    expect(preview, '找不到 ref={previewRef}，后面的比较会空转').toBeGreaterThanOrEqual(0)
    expect(toolbar).toBeLessThan(preview)
  })

  it.each(EDITORS)('T3 %s 只渲染一条工具条', ({ file }) => {
    const src = code(file)
    expect(src.split('<MarkdownToolbar').length - 1, '工具条被渲染了不止一次').toBe(1)
  })

  it('T4 共享组件的分隔线是 border-b（顶部位置），不能退回 border-t', () => {
    const attrs = classAttrsIn('components/MarkdownToolbar.tsx', code('components/MarkdownToolbar.tsx'))
    const root = attrs.filter((a) => a.text.includes('shrink-0') && a.text.includes('border-'))
    expect(root.length, '找不到工具条根节点的 class 属性').toBeGreaterThan(0)
    const tokens = root.flatMap((a) => classTokens(a.text))
    expect(tokens, '工具条没有下边框 —— 移回顶部后分隔线必须画在它下方').toContain('border-b')
    expect(tokens, '工具条还留着 border-t（那是它当年贴在底部的痕迹）').not.toContain('border-t')
    // 移动端可点：按钮自身要有内边距（否则 44px 触达区不足）
    expect(tokens).toContain('shrink-0')
  })
})
