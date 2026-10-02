// 守卫：TabBar 底部的版本/版权行（2026-10-02 用户要求）
//
// 用户的约束有两条，且互相拉扯：
//   ① 「放在最底部，字体小一点、对比度低一些，平时注意不到」；
//   ② 「**不要改变现有 TabBar 高度**」，并留一点点底部边距。
// 因此实现是三件事同时成立：绝对定位（不参与布局 ⇒ 高度不变）、
// 贴在安全区留白的上沿（避开 home indicator）、配色维持 AA 配对（不能再低）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classTokens, projectClassAttrs, projectRoot, stripComments } from './class-attrs'

function code(rel: string): string {
  return stripComments(readFileSync(join(projectRoot, rel), 'utf8'))
}

const TABBAR = 'components/TabBar.tsx'

describe('P · TabBar 底部的版本/版权行', () => {
  it('P0 解析自检（防空转）', () => {
    expect(code(TABBAR).length).toBeGreaterThan(500)
    expect(classTokens('x').length).toBeGreaterThanOrEqual(0)
  })

  it('P1 版本行存在，且文案与 VersionFooter 同源（NEXT_PUBLIC_VERSION / COPYRIGHT_NAME）', () => {
    const src = code(TABBAR)
    // ★ 断言**完整表达式**而不是变量名：只查 'NEXT_PUBLIC_VERSION' 的话，
    //   把变量改名成 NEXT_PUBLIC_VERSION_X（结果永远是 fallback 'dev'）也照样『通过』——
    //   非空转验证时就是这么漏过去的，已收紧。
    expect(src, '缺少版本号（与 VersionFooter 同一表达式）').toContain("process.env.NEXT_PUBLIC_VERSION ?? 'dev'")
    expect(src, '缺少版权名（与 VersionFooter 同一表达式）').toContain("process.env.NEXT_PUBLIC_COPYRIGHT_NAME ?? 'Orbit'")
    expect(src, '版权行应与登录页页脚同样写 © 2026').toContain('© 2026')
  })

  it('P2 绝对定位 ⇒ 不改变 TabBar 高度（用户明确要求）', () => {
    const src = code(TABBAR)
    expect(src, 'nav 需要 relative 才能给绝对定位的版本行做参照').toMatch(/<nav className="relative shrink-0[^"]*pb-safe/)
    // 版本行自身必须 absolute：进了文档流就会把 nav 撑高
    const i = src.indexOf('NEXT_PUBLIC_VERSION')
    expect(i).toBeGreaterThan(-1)
    const around = src.slice(Math.max(0, i - 600), i)
    expect(around, '版本行必须是绝对定位').toContain('absolute inset-x-0')
    // 且底部安全区仍由 nav 的 pb-safe 提供（没有被换成别的写法）
    expect(classTokens(projectClassAttrs().find((a) => a.file === TABBAR && a.text.includes('pb-safe'))?.text ?? '')).toContain('pb-safe')
  })

  it('P3 贴安全区留白上沿 ⇒ 留了一点底部边距，又不会压到 home indicator', () => {
    const src = code(TABBAR)
    expect(src, '缺少基于 safe-area-inset-bottom 的定位').toContain('max(env(safe-area-inset-bottom),1rem)')
    // 扣掉负值里的 8px 就是「留白上沿再下 8px」（2026-10-02 用户反馈「位置偏高」后由 4px 下移）；
    // 不能是 bottom-0（贴屏幕底边）
    expect(src, '版本行应再下移 8px').toContain('max(env(safe-area-inset-bottom),1rem)-8px)')
    expect(src).not.toMatch(/className="[^"]*\bbottom-0\b/)
  })

  it('P4 比登录页页脚更小/更淡，配色仍写完整 AA 配对', () => {
    const src = code(TABBAR)
    const i = src.indexOf('NEXT_PUBLIC_VERSION')
    const around = src.slice(Math.max(0, i - 600), i + 200)
    expect(around, '字号应比页脚的 10px 小两档（2026-10-02 用户要求再小一点）').toContain('text-[8px]')
    // 透明度走**元素 opacity**，不是 text-neutral-500/60 —— 后者会被 footnote-contrast 的 R3
    // 判定为「叠加透明度压低有效对比度」。两者视觉相近，但只有元素 opacity 不碰配色 token。
    expect(around, '缺少降低透明度的写法').toContain('opacity-60')
    expect(around, '不得改用文字色 alpha（会触发 R3）').not.toMatch(/text-neutral-\d{2,3}\/\d/)
    expect(around, '配色必须沿用 text-neutral-500 dark:text-neutral-400').toContain('text-neutral-500 dark:text-neutral-400')
  })
})
