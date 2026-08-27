import { NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/server/db'
import { keyWrappers } from '@/lib/server/db/schema'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { createSession, SESSION_COOKIE } from '@/lib/server/session'
import { rateLimit } from '@/lib/server/ratelimit'
import { assertSameOrigin } from '@/lib/server/auth'
import { purgeExpiredWipes } from '@/lib/server/pending-wipe'

// 灾难恢复登录：校验 Recovery Key 的 SHA-256（256-bit 熵，哈希不可爆破），签发 session。
// 服务器无法解密 wrapper（无 KEK），因此仅凭哈希校验。
export async function POST(req: Request) {
  if (!rateLimit('recovery-login', 5, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  // 惰性清理（未登录入口）：删除冷静期已过的数据
  await purgeExpiredWipes()
  const body = (await req.json().catch(() => null)) as { recoveryKey?: string } | null
  if (!body?.recoveryKey || !/^[A-Za-z0-9_-]{43}$/.test(body.recoveryKey)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  const hash = createHash('sha256').update(body.recoveryKey).digest('hex')
  // 冷静期内 wrapper 已标记软删但尚未物理删除——恢复密钥登录仍然允许
  // （撤销入口：设备丢失时也能登录回来撤销删除；倒计时结束 purge 后 wrapper
  // 被物理删除，此查询自然无结果 → 登录失败，用户重新初始化）
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
