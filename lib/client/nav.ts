// 底部导航的路径归属逻辑（纯函数，便于单测）。
//
// route group `(app)` 不产生 URL 段，所以这里的 href 就是真实路径，
// proxy.ts 的 matcher 与 proxy-guard 的 protectedPaths 都不需要改动。

export const TAB_HREFS = ['/', '/diary', '/settings'] as const
export type TabHref = (typeof TAB_HREFS)[number]

/**
 * 当前路径归属哪个 tab。
 *
 * - `/` 必须精确匹配，否则它会吞掉所有路径（空 base 匹配一切）
 * - `/entry/*` 归「日记」——详情是列表的下级，从列表点进去的
 * - 子路径（`/settings/prefs` 等）归各自的父 tab
 *
 * 返回 null 表示不属于任何 tab（`/login`、`/setup` 等，那里也不渲染 TabBar）。
 */
export function activeTab(pathname: string): TabHref | null {
  if (pathname === '/') return '/'
  if (pathname === '/diary' || pathname.startsWith('/diary/')) return '/diary'
  if (pathname === '/entry' || pathname.startsWith('/entry/')) return '/diary'
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return '/settings'
  return null
}
