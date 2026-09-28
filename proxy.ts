import { NextRequest, NextResponse } from 'next/server'
import { securityHeaders } from './lib/server/security-headers'
import { SESSION_COOKIE } from './lib/server/session'
import { decideLoginRedirect } from './lib/server/proxy-guard'

// Next 16 起 middleware 更名为 proxy（nodejs runtime）。功能与 matcher 约定一致。
// 只做粗粒度 cookie 存在检查 + 安全头；真实认证由 API handler 的 requireAuth 完成。
// 约束：DEK 仅存内存（刷新即失）⇒ /login 必须恒可达——禁止把已带 cookie 的请求从 /login 重定向走
// （否则刷新首页 → 页面守卫 !getDek() → /login → proxy 回 / → 死循环）。
// 客户端守卫已完备：/login 页 authenticated && getDek() 才跳首页；/setup 页检查 initialized。

export async function proxy(req: NextRequest) {
  const res = NextResponse.next()
  for (const [k, v] of Object.entries(securityHeaders())) res.headers.set(k, v)
  const path = req.nextUrl.pathname
  const hasSessionCookie = Boolean(req.cookies.get(SESSION_COOKIE)?.value)

  // 未登录访问受保护页面 → login（单向重定向）
  if (decideLoginRedirect(path, hasSessionCookie)) {
    const redirect = NextResponse.redirect(new URL('/login', req.url))
    // 重定向响应同样附加安全头（中间响应不渲染，但保证所有响应头一致）
    for (const [k, v] of Object.entries(securityHeaders())) redirect.headers.set(k, v)
    return redirect
  }
  return res
}

// 排除 prefetch 请求（浏览器 Link 预取；不参与重定向判定、不注入安全头）。
// 注意：matcher 必须全部内联字面量——SWC/Turbopack 静态求值不支持对象展开/常量引用。
export const config = {
  matcher: [
    { source: '/', missing: [{ type: 'header', key: 'purpose', value: 'prefetch' }] },
    { source: '/login', missing: [{ type: 'header', key: 'purpose', value: 'prefetch' }] },
    { source: '/setup', missing: [{ type: 'header', key: 'purpose', value: 'prefetch' }] },
    // /diary：路由由 /history 改名而来，必须显式加入——遗漏会导致该页面既没有安全头
    // （CSP / X-Frame-Options 等），也失去未登录重定向。tests/proxy-matcher-coverage.test.ts 会守住这一条
    { source: '/diary', missing: [{ type: 'header', key: 'purpose', value: 'prefetch' }] },
    { source: '/history', missing: [{ type: 'header', key: 'purpose', value: 'prefetch' }] },
    { source: '/entry/:path*', missing: [{ type: 'header', key: 'purpose', value: 'prefetch' }] },
    { source: '/settings/:path*', missing: [{ type: 'header', key: 'purpose', value: 'prefetch' }] },
  ],
}
