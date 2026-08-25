import { NextResponse } from 'next/server'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { credentials, keyWrappers } from '@/lib/server/db/schema'
import { rateLimit } from '@/lib/server/ratelimit'
import { generateLoginOptions, storeChallenge } from '@/lib/server/webauthn'

export async function GET() {
  if (!rateLimit('login-options', 10, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const all = await db.select().from(credentials)
  // @simplewebauthn 13.x JSON-first API：allowCredentials[].id 是 base64url 字符串，库中存的正是 base64url 文本
  const allowCredentials = all.map((c) => ({
    id: c.credentialId,
    transports: c.transports as AuthenticatorTransportFuture[],
  }))
  const { token, challenge } = storeChallenge('login')
  const options = await generateLoginOptions(allowCredentials)
  // PRF eval 输入 S：从任意 passkey_prf wrapper 的 salt 读取（S 对所有 passkey 一致，不属于敏感材料）
  const [anyPrf] = await db.select().from(keyWrappers).where(eq(keyWrappers.wrapperType, 'passkey_prf')).limit(1)
  return NextResponse.json({ token, options: { ...options, challenge }, prfEval: anyPrf?.salt ?? null })
}
