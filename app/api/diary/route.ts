import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { diaryEntries } from '@/lib/server/db/schema'
import { desc, eq } from 'drizzle-orm'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { diaryCreateSchema } from '@/lib/server/validation'
import { rateLimit } from '@/lib/server/ratelimit'

export async function GET(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 200)
  // 分页：offset（客户端"加载更多"）
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0)
  const entries = await db.select().from(diaryEntries).orderBy(desc(diaryEntries.createdAt)).limit(limit).offset(offset)
  return NextResponse.json({ entries })
}

export async function POST(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  if (!rateLimit('diary-create', 30, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const body = diaryCreateSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'bad_request', details: body.error.issues }, { status: 400 })
  const { id, ciphertext, iv, encryptionVersion, latitude, longitude, locationAccuracy, timezone, wordCount } = body.data
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
  }).returning()
  return NextResponse.json({ entry }, { status: 201 })
}
