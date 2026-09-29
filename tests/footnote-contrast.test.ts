import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classTokens, projectClassAttrs, projectRoot } from './class-attrs'

// ============================================================================
// 次级文字配色守卫（token 级）
//
// 背景（真实事故）：登录页版本页脚在 iPhone Safari / PWA 里「不显示」，根因之一是
// 用了 text-neutral-300 dark:text-neutral-600 这对**反向**配色——浅色模式画的是给深色底
// 准备的浅灰，深色模式画的是给浅色底准备的深灰，两端都不可读。10px 小字在这个对比度下
// 几乎不可见；桌面显示器离得近、屏幕大，勉强能看清，所以问题只在手机上暴露。
//
// 实测对比度（WCAG 2.1 相对亮度公式，浅色底 #ffffff / 深色底 #0a0a0a neutral-950）：
//   neutral-300   1.48:1 (浅)  / 13.36:1 (深)
//   neutral-400   2.52:1 (浅)  /  7.85:1 (深)
//   neutral-500   4.74:1 (浅)  /  4.18:1 (深)
//   neutral-600   7.81:1 (浅)  /  2.53:1 (深)
//   AA 正文门槛 4.5:1
// ⇒ 浅色端最低只能用 neutral-500；深色端最低只能用 neutral-400（更浅的 300 也行）。
// ⇒ 正确配对只有一个：text-neutral-500 dark:text-neutral-400
//
// 为什么改成 token 级（2026-09-29 加固）：
//   旧版断言只匹配「连写」的字符串 text-neutral-300 dark:text-neutral-600，且要求同一行
//   出现 class。结果是两类真实违规全部漏网：
//     a) 加了变体前缀 —— placeholder:text-neutral-300 … dark:placeholder:text-neutral-600
//        （AutoTextarea，输入框占位符，最典型的可读性场景）
//     b) 两端写在同一 className 里但不相邻 ——
//        text-sm text-neutral-300 active:opacity-60 dark:text-neutral-600（DiaryEditor）
//   现在按「变体前缀 + 工具类」解析每个 token，两种写法都逃不掉。
//
// 规则：
//   R1 浅色端（无 dark: 前缀）不得用 neutral-100 / 200 / 300 / 400
//   R2 深色端（dark: 前缀）不得用 neutral-500 及更深（600/700/800/900）
//   R3 不得用 text-neutral-xxx/50 这类透明度写法（有效对比度进一步下降）
//   R4 裸 text-neutral-500 的属性里必须同时给出 dark:text-neutral-{100,200,300,400}
//   R5 版本号 / 版权 / 诊断码等目标文件必须保留 AA 配对
// ============================================================================

const SECONDARY_TEXT_CLASS = 'text-neutral-500 dark:text-neutral-400'

const VARIANT_PREFIX = /^((?:[a-z-]+:)*)/
const UTILITY = /^text-neutral-(\d{2,3})(?:\/(\d{1,3}))?$/

interface Token { variants: string; utility: string; level: number; alpha?: string }

function neutralTextTokens(attr: string): Token[] {
  const out: Token[] = []
  for (const raw of classTokens(attr)) {
    if (!raw.includes('text-neutral-')) continue
    const variants = raw.match(VARIANT_PREFIX)?.[1] ?? ''
    const utility = raw.slice(variants.length)
    const m = utility.match(UTILITY)
    if (!m) continue
    out.push({ variants, utility, level: Number(m[1]), alpha: m[2] })
  }
  return out
}

describe('次级文字配色（WCAG AA token 级守卫）', () => {
  const all = projectClassAttrs()

  it('R0 解析自检：能按文件名取到 token', () => {
    // 防空转：路径分隔符若未归一化，R1~R4 会因为「一个 token 都取不到」而静默全绿。
    expect(all.length).toBeGreaterThan(100)
    expect(all.some((a) => a.file === 'components/TabBar.tsx')).toBe(true)
  })

  it('R1 浅色端不使用 neutral-100~400（对比度 ≤ 2.52:1）', () => {
    const offenders = all.flatMap((attr) =>
      neutralTextTokens(attr.text)
        .filter((t) => !t.variants.includes('dark:') && t.level <= 400)
        .map((t) => `${attr.file}:${attr.line} 使用 ${t.variants}${t.utility}（浅色对比度 ≤ 2.52:1）`),
    )
    expect(offenders).toEqual([])
  })

  it('R2 深色端不使用 neutral-500 及更深（对比度 ≤ 4.18:1）', () => {
    const offenders = all.flatMap((attr) =>
      neutralTextTokens(attr.text)
        .filter((t) => t.variants.includes('dark:') && t.level >= 500)
        .map((t) => `${attr.file}:${attr.line} 使用 ${t.variants}${t.utility}（深色对比度 ≤ 4.18:1）`),
    )
    expect(offenders).toEqual([])
  })

  it('R3 不叠加透明度（/50 之类会进一步压低有效对比度）', () => {
    const offenders = all.flatMap((attr) =>
      neutralTextTokens(attr.text)
        .filter((t) => t.alpha !== undefined)
        .map((t) => `${attr.file}:${attr.line} 使用 ${t.variants}${t.utility}`),
    )
    expect(offenders).toEqual([])
  })

  it('R4 裸 text-neutral-500 必须带 dark 端配对', () => {
    const offenders = all.flatMap((attr) => {
      const tokens = neutralTextTokens(attr.text)
      const hasBare500 = tokens.some((t) => t.variants === '' && t.level === 500)
      if (!hasBare500) return []
      const hasDarkCounterpart = tokens.some((t) => t.variants.includes('dark:') && t.level <= 400)
      return hasDarkCounterpart ? [] : [`${attr.file}:${attr.line} 有 text-neutral-500 但缺 dark:text-neutral-400`]
    })
    expect(offenders).toEqual([])
  })

  it('R5 版本号 / 版权 / 诊断码保留 AA 配对', () => {
    // VersionFooter 是登录页与 UnlockPrompt 共用组件（两者是同一界面元素的两份拷贝）；
    // UnlockPrompt 是 PWA 冷启动的主要落点——cookie 30 天有效，多数冷启动不会经过 /login。
    const targets = [
      'app/login/page.tsx',
      'app/error.tsx',
      'components/AboutDialog.tsx',
      'components/VersionFooter.tsx',
      'components/UnlockPrompt.tsx',
    ]
    const missing = targets.filter((rel) => !readFileSync(join(projectRoot, rel), 'utf8').includes(SECONDARY_TEXT_CLASS))
    expect(missing).toEqual([])
  })
})
