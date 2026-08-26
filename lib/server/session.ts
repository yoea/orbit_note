import { SignJWT, jwtVerify } from 'jose'
import 'server-only'
import { env } from './env'

const secret = new TextEncoder().encode(env.SESSION_SECRET)
export const SESSION_COOKIE = 'qo_session'

export async function createSession(): Promise<string> {
  return new SignJWT({ sub: 'owner' })
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
