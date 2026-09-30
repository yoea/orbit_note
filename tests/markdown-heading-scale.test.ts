import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================================
// Markdown 标题字号阶梯守卫（2026-09-30 加）
//
// 守的是一件事：**三级标题必须靠字号区分的、逐级递减，且都大于正文**。
//
// 改造前的实际状态（读代码得出，不是印象）：
//   h1 = 18px / 600
//   h2 = 16px / 600   ← 与 h3 完全同字号
//   h3 = 16px / 500   ← 与正文同字号（正文 16px / 400）
// 也就是说"三级标题"实际只有两级：h2 与 h3 只差一个 500→600 的字重级别，
// 而 h3 与正文只差 400→500。长文里几乎无法靠扫视定位层级。
//
// 现在：24 / 20 / 18（正文 16）+ 统一 font-semibold。
// 这条守卫防止它再退化回去（改字号是那种"改完没人看得出来、但读起来越来越糊"的改动）。
// ============================================================================

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

// Tailwind 默认字号阶梯（本项目只用标准值，不写 text-[17px] 这类任意值）
const FONT_PX: Record<string, number> = {
  'text-xs': 12,
  'text-sm': 14,
  'text-base': 16,
  'text-lg': 18,
  'text-xl': 20,
  'text-2xl': 24,
  'text-3xl': 30,
}

function readMarkdown(): string {
  return readFileSync(join(projectRoot, 'components/Markdown.tsx'), 'utf8')
}

function headingClass(src: string, level: 1 | 2 | 3): string {
  // 只认字面量 className="…"；若将来改成模板字符串，这里会明确报"找不到"而不是静默空转
  const m = src.match(new RegExp(`<h${level}\\s+className="([^"]+)"`))
  expect(m, `Markdown.tsx 里找不到 h${level} 的字面量 className（写法变了？）`).not.toBeNull()
  return m![1]
}

function fontSizeOf(className: string, label: string): number {
  const sizeTokens = className.split(/\s+/).filter((t) => /^text-(xs|sm|base|lg|xl|[2-9]xl)$/.test(t))
  expect(sizeTokens, `${label} 应恰好有一个字号 token，实际：${JSON.stringify(sizeTokens)}`).toHaveLength(1)
  return FONT_PX[sizeTokens[0]]
}

function bodyFontSize(src: string): number {
  // 容器：<div className={`qo-markdown text-base leading-relaxed …`}>
  const m = src.match(/qo-markdown\s+(text-[a-z0-9]+)/)
  expect(m, '找不到 Markdown 容器上的正文字号').not.toBeNull()
  return FONT_PX[m![1]]
}

describe('Markdown 标题字号阶梯', () => {
  const src = readMarkdown()

  it('H0 解析自检（防空转）', () => {
    expect(src.length).toBeGreaterThan(500)
    expect(Object.keys(FONT_PX).length).toBeGreaterThan(5)
    // 三个锚点都必须能取到，否则后面的断言全在比 -1
    for (const lvl of [1, 2, 3] as const) {
      expect(headingClass(src, lvl).length).toBeGreaterThan(5)
    }
  })

  it('H1 三级标题字号严格递减', () => {
    const h1 = fontSizeOf(headingClass(src, 1), 'h1')
    const h2 = fontSizeOf(headingClass(src, 2), 'h2')
    const h3 = fontSizeOf(headingClass(src, 3), 'h3')
    expect(h1, `h1(${h1}px) 必须大于 h2(${h2}px)`).toBeGreaterThan(h2)
    expect(h2, `h2(${h2}px) 必须大于 h3(${h3}px)`).toBeGreaterThan(h3)
  })

  it('H2 三级标题都大于正文（不许再与正文同字号）', () => {
    const body = bodyFontSize(src)
    for (const lvl of [1, 2, 3] as const) {
      const size = fontSizeOf(headingClass(src, lvl), `h${lvl}`)
      expect(size, `h${lvl}(${size}px) 必须大于正文(${body}px)`).toBeGreaterThan(body)
    }
  })

  it('H3 字重统一为 font-semibold（不再有 h3 用 medium 的例外）', () => {
    for (const lvl of [1, 2, 3] as const) {
      expect(headingClass(src, lvl), `h${lvl} 应使用 font-semibold`).toContain('font-semibold')
    }
  })

  it('H4 标题自带行高，不继承容器的 leading-relaxed', () => {
    // 容器是 leading-relaxed(1.625)：24px × 1.625 ≈ 39px，标题会与下方内容脱开
    for (const lvl of [1, 2, 3] as const) {
      expect(headingClass(src, lvl), `h${lvl} 应有自己的行高`).toContain('leading-snug')
    }
  })

  it('H5 首个标题不产生多余上边距（first:mt-0）', () => {
    for (const lvl of [1, 2, 3] as const) {
      expect(headingClass(src, lvl), `h${lvl} 应有 first:mt-0`).toContain('first:mt-0')
    }
  })
})
