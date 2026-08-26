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
