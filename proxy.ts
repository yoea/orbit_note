import { NextRequest, NextResponse } from 'next/server'
import { securityHeaders } from './lib/server/security-headers'
import { SESSION_COOKIE } from './lib/server/session'

// Next 16 起 middleware 更名为 proxy（nodejs runtime）。功能与 matcher 约定一致。
// 只做粗粒度 cookie 存在检查 + 安全头；真实认证由 API handler 的 requireAuth 完成。
const PROTECTED = ['/', '/history', '/entry', '/settings']
const PUBLIC_ONLY = ['/login', '/setup']

export async function proxy(req: NextRequest) {
  const res = NextResponse.next()
  for (const [k, v] of Object.entries(securityHeaders())) res.headers.set(k, v)
  const path = req.nextUrl.pathname
  const cookie = req.cookies.get(SESSION_COOKIE)?.value

  // 已登录访问 login/setup → 首页（粗粒度，真实校验在 API handler）
  if (cookie && PUBLIC_ONLY.some((p) => path.startsWith(p))) {
    return NextResponse.redirect(new URL('/', req.url))
  }
  // 未登录访问受保护页面 → login
  if (!cookie && PROTECTED.some((p) => path === p || path.startsWith(p + '/'))) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  return res
}

export const config = {
  matcher: ['/', '/login', '/setup', '/history', '/entry/:path*', '/settings/:path*'],
}
