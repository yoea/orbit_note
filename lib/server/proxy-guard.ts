// proxy 路由保护判定（纯函数，独立模块以便单元测试——不依赖 next/server）
// 约束（Task 13 质量审查固化）：DEK 仅存内存（刷新即失）⇒ /login 必须恒可达，
// 禁止把已带 cookie 的请求从 /login 重定向走，否则刷新 / → 页面守卫 → /login → proxy 回 / → 死循环。
// 客户端守卫已完备（/login 页 authenticated && getDek() 才跳首页；/setup 页检查 initialized），
// 因此这里只做单向保护：无 cookie 访问受保护路径 → /login。

export function decideLoginRedirect(pathname: string, hasSessionCookie: boolean): boolean {
  // '/diary' 是日记列表页（原 '/history' 改名而来）；两个都保留——'/history' 仅作重定向兼容页。
  // 注意：任何新增页面路由都要同时加进这里与 proxy.ts 的 matcher，
  // 否则该页面拿不到安全头且失去未登录重定向。
  const protectedPaths = ['/', '/diary', '/history', '/entry', '/settings']
  const isProtected = protectedPaths.some((p) => pathname === p || pathname.startsWith(p + '/'))
  return isProtected && !hasSessionCookie
}
