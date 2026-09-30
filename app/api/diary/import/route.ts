// 批量导入写路径（备份恢复 / 从 Day One、Journey 迁移）。
//
// 为什么单开一个端点而不是复用 POST /api/diary：
//   - 单条端点的限流是 30/min，导入 1000 篇要跑 33 分钟且会被 429 打断；
//   - 单条端点**刻意**不接受 created_at/updated_at（客户端时钟不可信），而导入必须保留原始时间。
//   所以这是一条独立的写路径：自己的限流额度、自己的校验 schema、自己的幂等策略。
//
// 幂等：客户端用 UUIDv5 从源标识确定性派生 id ⇒ 同一份文件重复导入算出的 id 完全一致，
// 这里再配合 `ON CONFLICT DO NOTHING`，重复导入是**静默跳过**而不是报错或翻倍。
import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { diaryEntries } from '@/lib/server/db/schema'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { MAX_IMPORT_BATCH, diaryImportEntrySchema } from '@/lib/server/validation'
import { rateLimit } from '@/lib/server/ratelimit'

// 允许的最大提前量：防御时钟错乱/脏文件把日记塞到时间线顶端（8225 年那种条目很难清）。
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000

interface RejectedItem {
  index: number
  id?: string
  reason: string
}

export async function POST(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  // 独立限流键（与被常规操作共用会互相挤占）：以速度优先——单批最多 200 条、客户端按体积
  // 自适应分批（约 50 条/请求）⇒ 1000 篇 ≈ 20 次请求。300/min 的额度远高于实际需求，
  // 但足以拦住脚本刷写。
  if (!rateLimit('diary-import', 300, 60_000)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as { entries?: unknown } | null
  const list = Array.isArray(body?.entries) ? (body.entries as unknown[]) : null
  if (!list) return NextResponse.json({ error: 'bad_request', message: '缺少 entries 数组' }, { status: 400 })
  if (list.length > MAX_IMPORT_BATCH) {
    return NextResponse.json({ error: 'batch_too_large', max: MAX_IMPORT_BATCH }, { status: 413 })
  }

  const rows: (typeof diaryEntries.$inferInsert)[] = []
  const rejected: RejectedItem[] = []
  const now = Date.now()

  for (let i = 0; i < list.length; i++) {
    const parsed = diaryImportEntrySchema.safeParse(list[i])
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      rejected.push({
        index: i,
        reason: issue ? `${issue.path.join('.') || 'entry'}: ${issue.message}` : '校验失败',
      })
      continue
    }
    const d = parsed.data
    const created = new Date(d.createdAt)
    if (created.getTime() > now + MAX_CLOCK_SKEW_MS) {
      rejected.push({ index: i, id: d.id, reason: '创建时间在未来（超过 24 小时）' })
      continue
    }
    const updated = new Date(d.updatedAt)
    rows.push({
      id: d.id,
      ciphertext: d.ciphertext,
      iv: d.iv,
      encryptionVersion: d.encryptionVersion,
      latitude: d.latitude ?? null,
      longitude: d.longitude ?? null,
      locationAccuracy: d.locationAccuracy ?? null,
      locationProvince: d.locationProvince ?? null,
      locationCity: d.locationCity ?? null,
      locationDistrict: d.locationDistrict ?? null,
      locationName: d.locationName ?? null,
      weather: d.weather ?? null,
      timezone: d.timezone ?? null,
      wordCount: d.wordCount ?? 0,
      starred: d.starred ?? false,
      createdAt: created,
      // updatedAt 不得早于 createdAt（脏文件里见过），否则详情页的"编辑于"会显示成创建之前
      updatedAt: updated.getTime() < created.getTime() ? created : updated,
    })
  }

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0, existing: 0, rejected })
  }

  // 单条 INSERT ... ON CONFLICT DO NOTHING：比「先 SELECT 再 INSERT」快一个数量级
  // （200 行一次往返 vs 200 次），并发下也天然幂等；returning 只带回真正插入的行。
  const inserted = await db
    .insert(diaryEntries)
    .values(rows)
    .onConflictDoNothing({ target: diaryEntries.id })
    .returning({ id: diaryEntries.id })

  return NextResponse.json({
    inserted: inserted.length,
    existing: rows.length - inserted.length,
    rejected,
  })
}
