import { SignJWT, jwtVerify } from 'jose'
import 'server-only'
import { env } from './env'

const secret = new TextEncoder().encode(env.SESSION_SECRET)
export const SESSION_COOKIE = 'qo_session'

export async function createSession(credentialId?: string): Promise<string> {
  return new SignJWT({ sub: 'owner', ...(credentialId ? { cred: credentialId } : {}) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('quiet-orbit')
    .setAudience('quiet-orbit')
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret)
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] })
    if (payload.sub !== 'owner' || payload.iss !== 'quiet-orbit' || payload.aud !== 'quiet-orbit') return false
    return true
  } catch {
    return false
  }
}

// 会话绑定的凭证 ID（本次登录用的通行密钥；恢复密钥登录的会话无此字段 → null）。
// 用于设置页标注"当前登录"用的是哪把 key。
export async function getSessionCredential(req: Request): Promise<string | null> {
  const cookie = req.headers.get('cookie') ?? ''
  const token = cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${SESSION_COOKIE}=`))?.split('=')[1]
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] })
    return typeof payload.cred === 'string' && payload.cred.length > 0 ? payload.cred : null
  } catch {
    return null
  }
}
