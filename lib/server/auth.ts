import { env } from './env'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { credentials } from '@/lib/server/db/schema'
import { getSessionCredential, SESSION_COOKIE, verifySessionToken } from './session'

// 从 cookie 提取 session token 并验证（不抛错，失败返回 false）。
// 关键：会话绑定了登录时的凭证 ID——若该凭证被禁用/删除，会话同步失效
// （禁用某设备 = 该设备上已登录的会话立即被踢下线，而非只挡住下次登录）。
// 恢复密钥登录的会话无凭证绑定（cred 为 null），不在此校验范围。
export async function isAuthed(req: Request): Promise<boolean> {
  const cookie = req.headers.get('cookie') ?? ''
  const token = cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${SESSION_COOKIE}=`))?.split('=')[1]
  if (!token) return false
  if (!(await verifySessionToken(token))) return false
  const credId = await getSessionCredential(req)
  if (!credId) return true
  const [cred] = await db.select().from(credentials).where(eq(credentials.credentialId, credId))
  // 凭证不存在（已物理删除）或被禁用 → 会话失效
  if (!cred || cred.disabled) return false
  return true
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
