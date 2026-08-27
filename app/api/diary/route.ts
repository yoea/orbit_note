import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { diaryEntries } from '@/lib/server/db/schema'
import { desc } from 'drizzle-orm'
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
  const { ciphertext, iv, encryptionVersion, latitude, longitude, locationAccuracy, timezone, wordCount } = body.data
  const [entry] = await db.insert(diaryEntries).values({
    ciphertext, iv, encryptionVersion,
    latitude: latitude ?? null, longitude: longitude ?? null, locationAccuracy: locationAccuracy ?? null,
    timezone: timezone ?? null,
    wordCount: wordCount ?? 0,
  }).returning()
  return NextResponse.json({ entry }, { status: 201 })
}
