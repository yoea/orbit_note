import { NextResponse } from 'next/server'
import { isNotNull } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { credentials, diaryEntries, drafts, keyWrappers } from '@/lib/server/db/schema'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/ratelimit'

// 撤销删除（冷静期内）：清除全部 deleted_at 标记，数据恢复可见。
// 冷静期过后 purge 已物理删除，此接口将无行可恢复（幂等返回 ok）。
export async function POST(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  if (!rateLimit('wipe-undo', 5, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  await db.transaction(async (tx) => {
    await tx.update(drafts).set({ deletedAt: null }).where(isNotNull(drafts.deletedAt))
    await tx.update(diaryEntries).set({ deletedAt: null }).where(isNotNull(diaryEntries.deletedAt))
    await tx.update(keyWrappers).set({ deletedAt: null }).where(isNotNull(keyWrappers.deletedAt))
    await tx.update(credentials).set({ deletedAt: null }).where(isNotNull(credentials.deletedAt))
  })
  return NextResponse.json({ ok: true })
}
