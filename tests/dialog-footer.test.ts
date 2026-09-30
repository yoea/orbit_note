// 守卫：iOS Alert 风格弹窗的底部按钮只有一种结构。
//
// 背景：设置页那一族弹窗（偏好设置 / 关于 / 通行密钥 / 重新生成恢复密钥）的底部
// 「完成」曾分成两种写法：
//   A. 直贴卡片边缘的一整行 —— `border-t … py-3.5`，总高约 52px（ConfirmDialog 的双按钮
//      行、NameEditDialog、PrefsDialog 都是这样）；
//   B. `border-t … p-3` 外层包裹 + `w-full rounded-xl py-3.5` 圆角胶囊 —— 总高约 76px。
// 于是同一个「点一下关闭」的动作，在相邻的两个弹窗里一个高一个矮，差 24px。
//
// 现统一为 A（也是 iOS 原生 Alert 的惯例：按钮是整宽行、以分隔线分栏）。
// 这个测试同时守住两件事：底部条必须带 border-t 且按钮是 py-3.5 + text-base（高度一致），
// 以及**不许再退回 p-3 包裹的胶囊**（高度漂移的来源）。
//
// 解析走 tests/class-attrs.ts（按属性边界抽 className 并剥注释），不写字符串 grep：
// 注释里为说明问题会引用被禁的写法，grep 会把文档当用法。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classAttrsIn, classTokens, projectRoot, stripComments } from './class-attrs'

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

function attrsOf(rel: string) {
  return classAttrsIn(rel, stripComments(readFileSync(join(projectRoot, rel), 'utf8')))
}

describe('弹窗底部按钮：统一为贴边整行（border-t + py-3.5）', () => {
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

  it.each(DIALOGS)('%s 遮罩点击即关闭（onClick 挂在遮罩上）', (file) => {
    const src = stripComments(readFileSync(join(projectRoot, file), 'utf8'))
    expect(src, `${file} 遮罩缺少 onClick 关闭`).toMatch(/fixed inset-0[^>]*onClick=/)
  })
})
