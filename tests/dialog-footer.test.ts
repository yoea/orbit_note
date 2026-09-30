// 守卫：iOS Alert 风格弹窗的底部按钮只有一种结构，而且是整宽的。
//
// 背景一（高度漂移，rc5 修的）：设置页那一族弹窗的底部「完成」曾分成两种写法——
//   A. 直贴卡片边缘的一整行 —— `border-t … py-3.5`，总高约 52px（ConfirmDialog 的双按钮
//      行、NameEditDialog、PrefsDialog 都是这样）；
//   B. `border-t … p-3` 外层包裹 + `w-full rounded-xl py-3.5` 圆角胶囊 —— 总高约 76px。
//   同一个「点一下关闭」的动作，在相邻弹窗里一个高一个矮，差 24px。已统一为 A。
//
// 背景二（宽度收缩，rc6 之后用户反馈「关于的完成按钮显示异常」）：
//   换成 A 之后，AboutDialog / PasskeysDialog / RecoveryRegenerateDialog 的**卡片是普通块级
//   容器**（`w-full max-w-sm overflow-hidden rounded-2xl …`，没有 flex），裸 `<button>` 的默认
//   display 是 inline-block ⇒ 宽度收缩到内容宽度：按钮变成「两个字宽的小块」贴在左边，
//   而上面的 border-t 分隔线仍然通长。PrefsDialog 之所以看起来正常，只是因为它的卡片恰好是
//   `flex flex-col`（按钮被 align-items:stretch 拉满）——**这个差异靠肉眼很容易漏掉**。
//   所以现在统一走 lib/client/ui.ts 的 DIALOG_FOOTER_BUTTON_CLASS（自带 w-full），
//   并由本文件的三条断言钉住：整宽、共用常量、常量自己带 w-full。
//
// 解析走 tests/class-attrs.ts（按属性边界抽 className 并剥注释），不写字符串 grep：
// 注释里为说明问题会引用被禁的写法，grep 会把文档当用法。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classAttrsIn, classTokens, projectRoot, stripComments } from './class-attrs'
import { DIALOG_FOOTER_BUTTON_CLASS } from '@/lib/client/ui'

// 全部「iOS Alert 风格、底部一排按钮」的弹窗
const DIALOGS = [
  'components/ConfirmDialog.tsx',
  'components/InputConfirmDialog.tsx',
  'components/NameEditDialog.tsx',
  'components/PrefsDialog.tsx',
  'components/AboutDialog.tsx',
  'components/PasskeysDialog.tsx',
  'components/RecoveryRegenerateDialog.tsx',
]

// 底部只有一个按钮、样式已收敛到共享常量的四个弹窗
const SOLO_FOOTER_DIALOGS = [
  'components/PrefsDialog.tsx',
  'components/AboutDialog.tsx',
  'components/PasskeysDialog.tsx',
  'components/RecoveryRegenerateDialog.tsx',
]

// className 里现在写的是 {DIALOG_FOOTER_BUTTON_CLASS}。展开常量这一步在 tests/class-attrs.ts
// 的 classAttrsIn 里统一做了（那里有详细说明：不展开的话「按 token 找 border-t / py-3.5」
// 在共享常量的弹窗上永远找不到，断言会静默空转）。
function attrsOf(rel: string) {
  return classAttrsIn(rel, stripComments(readFileSync(join(projectRoot, rel), 'utf8')))
}

describe('弹窗底部按钮：贴边整行 + 整宽', () => {
  it('F0 解析自检：每个弹窗都能读到 className（防空转）', () => {
    for (const f of DIALOGS) {
      const attrs = attrsOf(f)
      expect(attrs.length, `${f} 一个 className 都没解析到`).toBeGreaterThan(3)
    }
  })

  it.each(DIALOGS)('%s 的底部条用 border-t 分隔，没有 p-3 包裹层', (file) => {
    const attrs = attrsOf(file)
    const bars = attrs.filter((a) => classTokens(a.text).includes('border-t'))
    expect(bars.length, `${file} 找不到带 border-t 的底部条`).toBeGreaterThan(0)
    for (const bar of bars) {
      expect(
        classTokens(bar.text),
        `${file}:${bar.line} 底部条又用 p-3 包裹了——那会让按钮总高从 ~52px 涨到 ~76px，
        与 ConfirmDialog / PrefsDialog 的「完成」不再等高（统一写法见本文件顶部的 A）`,
      ).not.toContain('p-3')
    }
  })

  it.each(DIALOGS)('%s 的按钮高度是 py-3.5 + text-base', (file) => {
    const attrs = attrsOf(file)
    const ok = attrs.some((a) => {
      const t = classTokens(a.text)
      return t.includes('py-3.5') && t.includes('text-base')
    })
    expect(ok, `${file} 找不到 py-3.5 + text-base 的底部按钮`).toBe(true)
  })

  // ★ 这条是 rc6 事故的直接守卫：按钮必须自己撑满宽度，不能指望「父级恰好是 flex」。
  it.each(DIALOGS)('%s 的底部按钮是整宽的（w-full 或 flex-1 至少有一个）', (file) => {
    const attrs = attrsOf(file)
    const buttons = attrs.filter((a) => {
      const t = classTokens(a.text)
      return t.includes('py-3.5') && t.includes('text-base')
    })
    expect(buttons.length, `${file} 解析不到底部按钮，这条断言会空转`).toBeGreaterThan(0)
    for (const b of buttons) {
      const t = classTokens(b.text)
      expect(
        t.includes('w-full') || t.includes('flex-1'),
        `${file}:${b.line} 底部按钮既没有 w-full 也没有 flex-1 —— 块级卡片里 <button> 默认是
        inline-block，宽度会收缩成内容宽度（"完成"两个字的小块贴在左边），而 border-t 分隔线
        还是通长的，看起来就是「按钮样式错乱」。` +
        `\n  ★ 补 w-full 不是可选项：PrefsDialog 看起来正常只是因为它的卡片恰好是 flex-col。`,
      ).toBe(true)
    }
  })

  it.each(SOLO_FOOTER_DIALOGS)('%s 的单按钮底栏共用 DIALOG_FOOTER_BUTTON_CLASS', (file) => {
    const src = stripComments(readFileSync(join(projectRoot, file), 'utf8'))
    expect(src, `${file} 没有从 lib/client/ui 引入底部按钮常量`).toContain("from '@/lib/client/ui'")
    expect(src, `${file} 没有使用 DIALOG_FOOTER_BUTTON_CLASS`).toContain('DIALOG_FOOTER_BUTTON_CLASS')
    // 手写形态：border-t 与 py-3.5 挤在同一串字面量里
    expect(src, `${file} 又手写了底部按钮 class 串`).not.toMatch(/border-t border-neutral-200 py-3\.5/)
  })

  it('常量本身：w-full + border-t + py-3.5 + text-base（四处单按钮弹窗的唯一来源）', () => {
    const t = classTokens(DIALOG_FOOTER_BUTTON_CLASS)
    expect(t, '缺 w-full ⇒ 块级卡片里按钮会缩成两个字宽').toContain('w-full')
    expect(t).toContain('border-t')
    expect(t).toContain('py-3.5')
    expect(t).toContain('text-base')
  })

  it.each(DIALOGS)('%s 遮罩点击即关闭（onClick 挂在遮罩上）', (file) => {
    const src = stripComments(readFileSync(join(projectRoot, file), 'utf8'))
    expect(src, `${file} 遮罩缺少 onClick 关闭`).toMatch(/fixed inset-0[^>]*onClick=/)
  })
})
