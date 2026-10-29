import { NextResponse } from 'next/server'
import { isNull } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { diaryEntries } from '@/lib/server/db/schema'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/ratelimit'

// 「归档所有日记」（2026-10-29）：一条 UPDATE 把**所有未归档的**行收进归档。
//
// 为什么必须是专用接口，而不是让客户端拉全表 id 再走 `/api/diary/archive`：
//   · 客户端本来不知道全表 id，要先拉完所有条目才知道 —— 几百篇就是几百 KB 的密文白拉一趟；
//   · 拉 id 与提交之间可能又写了一篇 ⇒ 那一篇漏掉，而用户以为"全都归档了"；
//   · `/api/diary/archive` 的 `MAX_BULK_ARCHIVE` 上限是为「勾选一批」设计的，全表会直接 400。
// ⇒ 服务端一句 UPDATE 覆盖全部目标行：要么成、要么报错，**不存在部分成功**。
//
// ★ 与批量归档同样的两条硬约定（改之前先读 /api/diary/archive 的文件头）：
//   1. **绝不碰 updated_at** —— 归档是元数据更新不是编辑，碰了详情页会凭空多一行「上次编辑」；
//   2. **只动 archived_at IS NULL 的行** —— 已经归档的绝不能刷时间，否则归档页的
//      「归档于 3 天前」会一夜之间全部变成「今天」。
//
// ★ 为什么要 `RETURNING id`：客户端拿到 id 才能回写本地密文缓存（离线时列表页读缓存，
//   不改缓存 ⇒ 断网后那些日记在列表里"复活"）。代价是一次性回传一批 uuid（单用户量级，
//   千篇约 36KB），换来的是离线一致性 —— 这笔交换是划算的。
//
// 限流 **5 次/分钟**（批量归档是 20）：它一次动全表，连点两下的后果是整个日常列表被清空
// （能取消归档还原，但那要一篇篇挑回来）。入口本身在彩蛋页里、还要过一次确认，
// 正常根本到不了这个频率 —— 限流防的是脚本误触与重复提交。
export async function POST(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  // 限流 key 必须**静态**（记忆铁律：动态 key 会让限流形同虚设）
  if (!rateLimit('diary-archive-all', 5, 60_000)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  }
  // 同一批行共用一个时间戳：客户端回写缓存/队列要用**同一个值**，
  // 否则「归档于 X 天前」在本地与服务器上会差出几天。
  // ★ 必须是 Date 对象 —— drizzle 的 timestamp 列只吃 Date，塞字符串是 500 不是 400。
  const at = new Date()
  const changed = await db
    .update(diaryEntries)
    // 只 set 这一列。**不要在这里顺手写 updatedAt**（见文件头第 1 条）
    .set({ archivedAt: at })
    .where(isNull(diaryEntries.archivedAt))
    .returning({ id: diaryEntries.id })
  return NextResponse.json({
    updated: changed.length,
    archivedAt: at.toISOString(),
    ids: changed.map((r) => r.id),
  })
}
