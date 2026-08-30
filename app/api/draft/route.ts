import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { drafts } from '@/lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { draftPutSchema } from '@/lib/server/validation'
import { rateLimit } from '@/lib/server/ratelimit'

const DRAFT_ID = '00000000-0000-0000-0000-000000000001'

export async function GET(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const [draft] = await db.select().from(drafts).where(eq(drafts.id, DRAFT_ID))
  return NextResponse.json({ draft: draft ?? null })
}

export async function PUT(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  if (!rateLimit('draft-save', 60, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const body = draftPutSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'bad_request', details: body.error.issues }, { status: 400 })
  const { ciphertext, iv, encryptionVersion, updatedAt } = body.data
  // 条件更新：body 携带客户端 updatedAt（epoch ms）时，若早于服务器现有草稿时间戳则拒绝，
  // 保留服务器新版本（防旧客户端覆盖新草稿；客户端与服务器时钟存在偏差，收敛靠推送成功后回写服务器时间戳）
  if (updatedAt !== undefined) {
    const [existing] = await db
      .select({ updatedAt: drafts.updatedAt })
      .from(drafts)
      .where(eq(drafts.id, DRAFT_ID))
    if (existing && updatedAt < existing.updatedAt.getTime()) {
      return NextResponse.json({ error: 'stale_draft' }, { status: 409 })
    }
  }
  const now = new Date()
  const [draft] = await db.insert(drafts)
    .values({ id: DRAFT_ID, ciphertext, iv, encryptionVersion, updatedAt: now })
    .onConflictDoUpdate({ target: drafts.id, set: { ciphertext, iv, encryptionVersion, updatedAt: now } })
    .returning()
  return NextResponse.json({ draft })
}

export async function DELETE(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  await db.delete(drafts).where(eq(drafts.id, DRAFT_ID))
  return new NextResponse(null, { status: 204 })
}
