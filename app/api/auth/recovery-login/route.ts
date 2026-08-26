import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { db } from '@/lib/server/db'
import { keyWrappers } from '@/lib/server/db/schema'
import { and, eq, isNotNull } from 'drizzle-orm'
import { createSession, SESSION_COOKIE } from '@/lib/server/session'
import { rateLimit } from '@/lib/server/ratelimit'

// 灾难恢复登录：校验 Recovery Key 的 SHA-256（256-bit 熵，哈希不可爆破），签发 session。
// 服务器无法解密 wrapper（无 KEK），因此仅凭哈希校验。
export async function POST(req: Request) {
  if (!rateLimit('recovery-login', 5, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const body = (await req.json().catch(() => null)) as { recoveryKey?: string } | null
  if (!body?.recoveryKey || !/^[A-Za-z0-9_-]{43}$/.test(body.recoveryKey)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  const hash = createHash('sha256').update(body.recoveryKey).digest('hex')
  const [rec] = await db
    .select()
    .from(keyWrappers)
    .where(and(eq(keyWrappers.wrapperType, 'recovery'), isNotNull(keyWrappers.recoveryKeyHash)))
    .limit(1)
  if (!rec || rec.recoveryKeyHash !== hash) {
    return NextResponse.json({ error: 'invalid_recovery_key' }, { status: 401 })
  }
  const session = await createSession()
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, session, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 })
  return res
}
