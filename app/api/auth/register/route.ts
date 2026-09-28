import { NextResponse } from 'next/server'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import { db } from '@/lib/server/db'
import { credentials, userProfile } from '@/lib/server/db/schema'
import { createSession, SESSION_COOKIE } from '@/lib/server/session'
import { takeChallenge, verifyRegistration } from '@/lib/server/webauthn'
import { rateLimit } from '@/lib/server/ratelimit'
import { assertSameOrigin, isAuthed } from '@/lib/server/auth'
import { PROFILE_OWNER_ID } from '@/lib/server/validation'

export async function POST(req: Request) {
  if (!rateLimit('register', 5, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  const body = (await req.json().catch(() => null)) as { token?: string; registration?: unknown; device?: string } | null
  if (!body?.token || !body.registration) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const existing = await db.select().from(credentials).limit(1)
  // 已初始化：注册仅允许已登录用户（完整 JWT 验证，防伪造 cookie 获得 session 后调用 wipe）
  if (existing.length > 0 && !(await isAuthed(req))) {
    return NextResponse.json({ error: 'already_initialized' }, { status: 403 })
  }
  // 本次是否为「首次注册」（即创建账号）——只有这一次才写注册时间
  const isFirstRegistration = existing.length === 0

  // 形状防御检查后再 cast（@simplewebauthn 13.x JSON 响应类型）
  const registration = body.registration as RegistrationResponseJSON
  if (!registration.id || !registration.response) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const expectedChallenge = takeChallenge(body.token, 'register')
  if (!expectedChallenge) return NextResponse.json({ error: 'challenge_expired' }, { status: 400 })

  const verification = await verifyRegistration(registration, expectedChallenge).catch(() => null)
  if (!verification?.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: 'verification_failed' }, { status: 400 })
  }

  const { credential } = verification.registrationInfo
  const base64url = (b: Uint8Array) => Buffer.from(b).toString('base64url')
  await db.insert(credentials).values({
    // 13.x 的 credential.id 已是 base64url 字符串（JSON-first API），无需再编码
    credentialId: credential.id,
    publicKey: base64url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    // 设备标识（客户端 UA 解析，仅展示用途；长度防御）
    device: typeof body.device === 'string' && body.device.length <= 64 ? body.device : null,
  }).onConflictDoNothing()

  // 首次注册即创建账号：记录注册时间（设置页个人信息展示用）。
  // onConflictDoNothing —— 重复调用不会覆盖已有行；用户名（密文）由客户端稍后懒写入，
  // 那条 PUT 不会碰 created_at。
  if (isFirstRegistration) {
    await db.insert(userProfile)
      .values({ id: PROFILE_OWNER_ID, createdAt: new Date() })
      .onConflictDoNothing()
  }

  const session = await createSession()
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, session, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 })
  return res
}
