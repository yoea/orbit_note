import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { credentials, diaryEntries, drafts, keyWrappers } from '@/lib/server/db/schema'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/ratelimit'
import { SESSION_COOKIE } from '@/lib/server/session'

// 删除所有数据：日记、密钥包装、凭证、草稿（单用户重置）
// 删除顺序：先子表后父表（wrappers 无 FK，顺序不严格但保持此顺序）
export async function POST(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  if (!rateLimit('wipe', 3, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  await db.delete(drafts)
  await db.delete(diaryEntries)
  await db.delete(keyWrappers)
  await db.delete(credentials)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
