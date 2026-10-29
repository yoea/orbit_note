import { NextResponse } from 'next/server'
import { inArray } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { diaryEntries } from '@/lib/server/db/schema'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/ratelimit'
import { bulkDeleteSchema } from '@/lib/server/validation'

// 批量**永久删除**（2026-10-29）。
//
// 与 POST /api/diary/archive 分开而不是合成一个 `{ids, action}` 接口：这两件事的
// 危险等级完全不同 —— 归档可逆（归档页能放回来），删除不可逆。合成一个接口后，
// 限流、审计、以及将来任何一侧的策略都只能二选一地共用。
//
// 为什么不能循环调 `DELETE /api/diary/[id]`：和归档同理，单实例内存滑动窗口下
// 50 条会撞 429，用户看到「选了 12 条只删掉 7 条」—— 而删除是**不可逆**的，
// 这种「部分成功且不知道是哪部分」的状态比归档场景恶劣得多。
//
// ★ 限流比归档更严（10 次/分钟）：归档误操作可以撤销，删除不能。
// ★ missing 如实返回：选中的条目可能已在别的设备上删掉了。
export async function POST(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  if (!rateLimit('diary-delete-bulk', 10, 60_000)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  }
  const body = bulkDeleteSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'bad_request', details: body.error.issues }, { status: 400 })
  const targets = [...new Set(body.data.ids)]

  // 一步删除 + RETURNING：拿到的就是真正删掉的那些，剩下的自然是不存在的。
  // （不像归档要区分「已达标」和「不存在」——删除没有"已经删过了"这种中间态）
  const gone = await db
    .delete(diaryEntries)
    .where(inArray(diaryEntries.id, targets))
    .returning({ id: diaryEntries.id })
  const deletedIds = new Set(gone.map((r) => r.id))
  const missing = targets.filter((id) => !deletedIds.has(id))

  return NextResponse.json({ deleted: gone.length, missing })
}
