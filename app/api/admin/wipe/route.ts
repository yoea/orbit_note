import { NextResponse } from 'next/server'
import { isNull } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { credentials, diaryEntries, drafts, keyWrappers } from '@/lib/server/db/schema'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/ratelimit'
import { WIPE_GRACE_MS } from '@/lib/server/pending-wipe'

// 删除所有数据（软删除 + 冷静期）：日记/草稿/密钥包装打 deleted_at 标记，180 秒内可撤销
// （POST /api/admin/wipe/undo）。超时后由惰性 purge + 服务器 crontab 物理删除。
// 关键：credentials 不标记——冷静期内用户仍可登录（任何设备）进设置页撤销删除，
// 倒计时结束 purge 时才连同凭证一起物理删除。冷静期内数据对用户不可见（各查询过滤 deleted_at）。
export async function POST(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  if (!rateLimit('wipe', 3, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.update(drafts).set({ deletedAt: now }).where(isNull(drafts.deletedAt))
    await tx.update(diaryEntries).set({ deletedAt: now }).where(isNull(diaryEntries.deletedAt))
    await tx.update(keyWrappers).set({ deletedAt: now }).where(isNull(keyWrappers.deletedAt))
    // credentials 故意不标记（冷静期登录撤销入口）；purge 到期时统一物理删除
  })
  return NextResponse.json({ ok: true, deletedAt: now.toISOString(), graceMs: WIPE_GRACE_MS })
}
