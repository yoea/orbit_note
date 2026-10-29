import { NextResponse } from 'next/server'
import { and, inArray, isNotNull, isNull } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { diaryEntries } from '@/lib/server/db/schema'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/ratelimit'
import { bulkArchiveSchema } from '@/lib/server/validation'

// 批量归档 / 取消归档（2026-10-29，阶段 4）。
//
// 为什么必须是一个专用接口、不能让客户端循环调 PATCH /api/diary/[id]：
// 限流是**单实例内存滑动窗口**（lib/server/ratelimit.ts），50 条就会撞出 429，
// 用户看到的是「选了 12 条只成功 7 条」，而且不知道是哪 7 条 —— 失败被吞在循环里。
// 这里一次 UPDATE 全部落库：要么成、要么报错，不存在「部分成功但不告诉你」。
//
// ★ 三条硬约定（与单条 PATCH 完全一致，改之前先读）：
//   1. **绝不碰 updated_at** —— 归档是元数据更新不是编辑。碰了，详情页会凭空多一行「上次编辑」；
//   2. **已经处于目标状态的行不改** —— 否则「批量归档」会把早已归档那几篇的**归档时间**刷成今天，
//      归档页的「归档于 3 天前」全部变成「今天」；
//   3. **missing 要如实返回** —— 选中项可能已在别的设备上删掉了。不告诉客户端，
//      用户会以为「选了 10 篇，怎么只有 8 篇消失」。
export async function POST(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  // 限流 key 必须**静态**（记忆铁律：动态 key 会让限流形同虚设）。
  // 20 次/分钟：一次批量可能上百条，正常使用远到不了这个量；连点两次也不会被误拦。
  if (!rateLimit('diary-archive-bulk', 20, 60_000)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  }
  const body = bulkArchiveSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'bad_request', details: body.error.issues }, { status: 400 })
  const { archived } = body.data
  // 去重：客户端可能因为「全选 + 单独点」送出重复 id，重复的 id 在 UPDATE 里没有意义
  const targets = [...new Set(body.data.ids)]

  // 先查存在性（只取 id，不取密文）
  const existing = await db
    .select({ id: diaryEntries.id })
    .from(diaryEntries)
    .where(inArray(diaryEntries.id, targets))
  const existingIds = existing.map((r) => r.id)
  const existingSet = new Set(existingIds)
  const missing = targets.filter((id) => !existingSet.has(id))

  let updated = 0
  if (existingIds.length > 0) {
    const changed = await db
      .update(diaryEntries)
      // 只 set 这一列。**不要在这里顺手写 updatedAt**（见文件头第 1 条）
      .set({ archivedAt: archived ? new Date() : null })
      .where(and(
        inArray(diaryEntries.id, existingIds),
        // 已经在目标状态的跳过（见文件头第 2 条）：
        // 归档只处理当前未归档的；取消归档只处理当前已归档的
        archived ? isNull(diaryEntries.archivedAt) : isNotNull(diaryEntries.archivedAt),
      ))
      .returning({ id: diaryEntries.id })
    updated = changed.length
  }
  return NextResponse.json({ updated, missing })
}
