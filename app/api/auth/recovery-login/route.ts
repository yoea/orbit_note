import { NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/server/db'
import { keyWrappers } from '@/lib/server/db/schema'
import { and, eq, isNotNull } from 'drizzle-orm'
import { createSession, SESSION_COOKIE } from '@/lib/server/session'
import { rateLimit } from '@/lib/server/ratelimit'
import { assertSameOrigin } from '@/lib/server/auth'

// 灾难恢复登录：校验 Recovery Key 的 SHA-256（256-bit 熵，哈希不可爆破），签发 session。
// 服务器无法解密 wrapper（无 KEK），因此仅凭哈希校验。
export async function POST(req: Request) {
  // 全局桶放宽到 30/min（原 5/min）：攻击者可用垃圾请求以 5/min 灌满原桶，锁死本人的
  // 灾难恢复通道（P1）。安全性不靠限流：恢复密钥 256-bit 熵，即使 30/min 持续爆破，
  // 一年 ≈1.6e7 次尝试 vs 2^256 空间，数学上不可行；限流只防接口刷量与负载。
  // 配合 OpenResty 单 IP 10/min：单 IP 最多占桶 1/3。
  if (!rateLimit('recovery-login', 30, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
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
  if (!rec || !rec.recoveryKeyHash) {
    return NextResponse.json({ error: 'invalid_recovery_key' }, { status: 401 })
  }
  // 常数时间比较，防时序侧信道（两值均为 64 hex 字符 = 32 字节，先比长度兜底）
  const stored = Buffer.from(rec.recoveryKeyHash, 'hex')
  const provided = Buffer.from(hash, 'hex')
  if (stored.length !== provided.length || !timingSafeEqual(stored, provided)) {
    return NextResponse.json({ error: 'invalid_recovery_key' }, { status: 401 })
  }
  const session = await createSession()
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, session, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 })
  return res
}
