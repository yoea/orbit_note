import { SignJWT, jwtVerify } from 'jose'
import { env } from './env'

const secret = new TextEncoder().encode(env.SESSION_SECRET)
export const SESSION_COOKIE = 'qo_session'

export async function createSession(): Promise<string> {
  return new SignJWT({ sub: 'owner' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret)
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secret)
    return payload.sub === 'owner'
  } catch {
    return false
  }
}
