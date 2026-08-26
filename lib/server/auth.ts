import { env } from './env'
import { SESSION_COOKIE, verifySessionToken } from './session'

// 从 cookie 提取 session token 并验证（不抛错，失败返回 false）
export async function isAuthed(req: Request): Promise<boolean> {
  const cookie = req.headers.get('cookie') ?? ''
  const token = cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${SESSION_COOKIE}=`))?.split('=')[1]
  return token ? verifySessionToken(token) : false
}

export async function requireAuth(req: Request): Promise<boolean> {
  return isAuthed(req)
}

// CSRF 纵深防御：跨站请求校验（SameSite=Lax 已挡跨站 cookie，此为第二层）
export function assertSameOrigin(req: Request): boolean {
  const secFetchSite = req.headers.get('sec-fetch-site')
  if (secFetchSite === 'same-origin' || secFetchSite === 'none') return true
  if (secFetchSite === 'cross-site') return false
  // 无 Sec-Fetch-Site（旧客户端）：回退 Origin 校验
  const origin = req.headers.get('origin')
  if (!origin) return true // 同源 GET/无 Origin 的简单请求（表单）由 SameSite 保护
  try {
    const expected = new URL(env.WEBAUTHN_ORIGIN).origin
    return new URL(origin).origin === expected
  } catch {
    return false
  }
}
