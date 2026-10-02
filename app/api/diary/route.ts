import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { diaryEntries } from '@/lib/server/db/schema'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { diaryCreateSchema } from '@/lib/server/validation'
import { rateLimit } from '@/lib/server/ratelimit'

// 游标里的次级键必须是 uuid（DB 列是 uuid 类型，乱传会让 PG 报 22P02 → 500）
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 200)
  // 分页：offset（客户端"加载更多"）
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0)
  // ── 游标分页（`before` / `beforeId`）───────────────────────────────────────
  // 与 offset 并存，但用途不同：**客户端无限滚动只走游标**。
  //   · `before` + `beforeId`：取比该条更旧的一页（元组比较，见下）
  //   · 只给 `before`（不给 id）：按时间边界取「比它更旧的」，用于「按某天取一页」这类查询
  // 为什么必须补上它（offset 的真实缺陷）：offset 是「位置」而不是「内容」，
  // 翻页期间只要有人新增一篇（本应用写完就进列表），后面所有页整体位移 ⇒
  // 静默重复或漏条目。漏条目还会连带把本地缓存里那条判成「已删除」而清掉
  // （见 lib/client/offline.ts 的 staleCachedIds）。改成游标后位置由内容决定。
  //
  // ★ 2026-10-02：曾在这里加过反方向的 `after`/`afterId`（列表页锚定后向上回看）。
  //   那条链路整体删除了——列表页不再做「按日期定位」，按日期筛选搬到搜索面板里
  //   （见 components/SearchDialog.tsx 的 DayPicker 与 lib/client/search.ts 的 'd:' 时间档）。
  //   没有调用方就不留接口：留着的反方向参数会被误当成「已支持的能力」。
  const beforeRaw = url.searchParams.get('before')
  // 空串按「没给」处理：调用方可能用 `&beforeId=` 这种占位写法，别把它当成非法 uuid
  const beforeIdRaw = url.searchParams.get('beforeId') || null
  let cursor: { at: Date; id: string | null } | null = null
  if (beforeRaw) {
    const at = new Date(beforeRaw)
    if (Number.isNaN(at.getTime())) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
    if (beforeIdRaw !== null && !UUID_RE.test(beforeIdRaw)) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
    cursor = { at, id: beforeIdRaw }
  } else if (beforeIdRaw) {
    // 只给 id 不给时间没有意义（无法定位），视为坏请求而不是静默忽略
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  // ★ 排序必须是**全序**：created_at 相同（导入的 Day One/Journey 备份是秒级精度，
  // 同一批导入里很容易撞上）时，只按 created_at 排序的结果在 LIMIT/OFFSET 分页下不保证稳定：
  // 同一行可能在两次查询里落到不同页（被跳过或重复），客户端「加载更多」就会漏条目。
  // 补一个 id 次级键（uuid 可比较）即得到确定的全序，分页从此稳定；
  // 游标分支的 WHERE 也用同一组键，保证「排序」与「边界」口径完全一致。
  // created_at 相同时用元组比较 (created_at, id) < (游标 at, id)，
  // 否则同秒的多条会被整批跳过。
  const entries = await db.select().from(diaryEntries)
    .where(cursor
      ? (cursor.id
        ? or(
          lt(diaryEntries.createdAt, cursor.at),
          and(eq(diaryEntries.createdAt, cursor.at), lt(diaryEntries.id, cursor.id)),
        )
        : lt(diaryEntries.createdAt, cursor.at))
      : undefined)
    .orderBy(desc(diaryEntries.createdAt), desc(diaryEntries.id))
    // 游标已定位到内容，offset 必须归零（两者语义不能叠加）
    .limit(limit).offset(cursor ? 0 : offset)
  return NextResponse.json({ entries })
}

export async function POST(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  if (!rateLimit('diary-create', 30, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const body = diaryCreateSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'bad_request', details: body.error.issues }, { status: 400 })
  const { id, ciphertext, iv, encryptionVersion, latitude, longitude, locationAccuracy, timezone, wordCount, starred } = body.data
  // 客户端 id（离线写队列）：重复 POST 同 id = 网络抖动后的不确定重传，返回已有条目（200）
  // 而非报错——幂等保证离线日记不重复入库。created_at 仍由服务器决定（客户端时钟不可信）。
  if (id) {
    const [existing] = await db.select().from(diaryEntries).where(eq(diaryEntries.id, id)).limit(1)
    if (existing) return NextResponse.json({ entry: existing }, { status: 200 })
  }
  // 地点名由客户端反查后 PATCH 补写（保存不等待外部 API，即时返回）
  const [entry] = await db.insert(diaryEntries).values({
    ...(id ? { id } : {}),
    ciphertext, iv, encryptionVersion,
    latitude: latitude ?? null, longitude: longitude ?? null, locationAccuracy: locationAccuracy ?? null,
    timezone: timezone ?? null,
    wordCount: wordCount ?? 0,
    // 离线队列补传时可能带着「离线期间点过的收藏」；在线新建恒为 false（服务端默认）
    starred: starred ?? false,
  }).returning()
  return NextResponse.json({ entry }, { status: 201 })
}
