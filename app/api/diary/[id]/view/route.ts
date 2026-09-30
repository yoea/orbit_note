// 「打开次数」+1 —— `POST /api/diary/[id]/view`
//
// 为什么不复用 PATCH /api/diary/[id]（三个都成立，任一条都够）：
//   1) 计数必须是**原子自增**（`view_count = view_count + 1`）。让客户端 PATCH 一个绝对值，
//      会遇到「多标签页各自读出旧值再写回」的丢失更新；而且客户端能直接写统计数字本身就不该允许。
//   2) 语义上它既不是「编辑」也不是「改某条元数据」——它没有请求体，表达的是「我读了一次」
//      这个**事件**。挂成子资源的 POST 最能表达这一点，也不会污染 diaryUpdateSchema 的字段集
//      （PATCH 至今刻意不接受 viewCount，见 lib/server/validation.ts）。
//   3) 需要自己的限流额度：打开详情是高频动作，与创建（30/min）共用一个键会互相挤占。
//
// ★ 不碰 updated_at：回看一篇**不算编辑**（与收藏、补地点名同一条约定），
//   详情页不会因此冒出「编辑于」。实现上只 `set` 了 viewCount 一列 ——
//   drizzle 的 `update().set()` 只写列出的字段，不会连带刷新 updated_at。
import { NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { diaryEntries } from '@/lib/server/db/schema'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/ratelimit'

// 与 app/api/diary/[id]/route.ts 保持一致的本地校验（本仓路由的既有写法：
// 每个动态路由自带这个三行 helper，不抽公共模块）。
function parseId(param: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(param) ? param : null
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  // 独立限流键：正常阅读远低于这个额度，它只用来拦住「脚本无成本地刷统计」。
  if (!rateLimit('diary-view', 120, 60_000)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  }
  const { id } = await params
  if (!parseId(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  // returning 带回整行：客户端顺手用它刷新本地密文缓存，
  // 否则离线再打开这一篇会读到「+1 之前」的旧值。
  const [updated] = await db
    .update(diaryEntries)
    .set({ viewCount: sql`${diaryEntries.viewCount} + 1` })
    .where(eq(diaryEntries.id, id))
    .returning()
  if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ entry: updated })
}
