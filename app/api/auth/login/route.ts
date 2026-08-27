import { NextResponse } from 'next/server'
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from '@simplewebauthn/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { credentials } from '@/lib/server/db/schema'
import { createSession, SESSION_COOKIE } from '@/lib/server/session'
import { takeChallenge, verifyLogin } from '@/lib/server/webauthn'
import { rateLimit } from '@/lib/server/ratelimit'
import { assertSameOrigin } from '@/lib/server/auth'

export async function POST(req: Request) {
  if (!rateLimit('login', 10, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  const body = (await req.json().catch(() => null)) as { token?: string; assertion?: unknown; device?: string } | null
  if (!body?.token || !body.assertion) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  // 登录时客户端上报的设备名（仅用于凭证从未打标时自动补标，注册时已有标签的不覆盖）
  const device = typeof body.device === 'string' && body.device.length <= 64 ? body.device : null

  // 形状防御检查后再 cast（@simplewebauthn 13.x JSON 响应类型）
  const assertion = body.assertion as AuthenticationResponseJSON
  if (!assertion.id || !assertion.response) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const expectedChallenge = takeChallenge(body.token, 'login')
  if (!expectedChallenge) return NextResponse.json({ error: 'challenge_expired' }, { status: 400 })

  // 归一化 credentialId（base64url 解码再编码，容错大小写/填充差异）
  const credentialId = Buffer.from(assertion.id, 'base64url').toString('base64url')
  const [stored] = await db.select().from(credentials).where(eq(credentials.credentialId, credentialId))
  if (!stored) {
    console.error('[login] unknown_credential: received', credentialId.slice(0, 12), '…', 'stored ids:', (await db.select({ id: credentials.credentialId }).from(credentials)).map((c) => c.id.slice(0, 12)))
    return NextResponse.json({ error: 'unknown_credential' }, { status: 400 })
  }
  // 软禁用：凭证仍在库中，但拒绝认证（设置页可重新启用）
  if (stored.disabled) {
    return NextResponse.json({ error: 'disabled_credential' }, { status: 400 })
  }

  // 重要：存储的 publicKey 是 base64url 文本，需解码为 Uint8Array 传给 verifyLogin（@simplewebauthn 13.x 要求）
  const verification = await verifyLogin(assertion, expectedChallenge, {
    id: stored.credentialId,
    publicKey: Buffer.from(stored.publicKey, 'base64url'),
    counter: stored.counter,
    transports: stored.transports as AuthenticatorTransportFuture[],
  }).catch((e: unknown) => {
    // 诊断日志：只记录错误类型与 short id，不记录 assertion/密钥内容
    console.error('[login] verifyLogin error:', e instanceof Error ? `${e.name}: ${e.message}` : String(e), 'credential:', stored.credentialId.slice(0, 12), 'counter:', stored.counter)
    return null
  })

  if (!verification?.verified) return NextResponse.json({ error: 'verification_failed' }, { status: 400 })

  // counter 回滚防护
  const newCounter = verification.authenticationInfo.newCounter
  if (stored.counter > 0 && newCounter <= stored.counter) {
    return NextResponse.json({ error: 'counter_replay_detected' }, { status: 400 })
  }
  await db.update(credentials).set({
    counter: newCounter,
    lastUsedAt: new Date(),
    // 自动打标：仅当凭证尚无设备名时写入（注册时已标记的不覆盖）
    ...(stored.device == null && device ? { device } : {}),
  }).where(eq(credentials.credentialId, stored.credentialId))

  // 会话绑定本次登录的凭证——设置页可标注"当前登录"用的是哪把 key
  const session = await createSession(stored.credentialId)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, session, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 })
  return res
}
