import { NextResponse } from 'next/server'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import { db } from '@/lib/server/db'
import { credentials } from '@/lib/server/db/schema'
import { createSession, SESSION_COOKIE } from '@/lib/server/session'
import { takeChallenge, verifyRegistration } from '@/lib/server/webauthn'
import { rateLimit } from '@/lib/server/ratelimit'

export async function POST(req: Request) {
  if (!rateLimit('register', 5, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const body = (await req.json().catch(() => null)) as { token?: string; registration?: unknown } | null
  if (!body?.token || !body.registration) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const existing = await db.select().from(credentials).limit(1)
  if (existing.length > 0 && !(req.headers.get('cookie')?.includes(`${SESSION_COOKIE}=`) ?? false)) {
    return NextResponse.json({ error: 'already_initialized' }, { status: 403 })
  }

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
  }).onConflictDoNothing()

  const session = await createSession()
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, session, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 })
  return res
}
