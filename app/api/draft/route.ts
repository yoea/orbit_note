import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { drafts } from '@/lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/server/auth'
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
  if (!rateLimit('draft-save', 60, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const body = draftPutSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'bad_request', details: body.error.issues }, { status: 400 })
  const { ciphertext, iv, encryptionVersion } = body.data
  const now = new Date()
  const [draft] = await db.insert(drafts)
    .values({ id: DRAFT_ID, ciphertext, iv, encryptionVersion, updatedAt: now })
    .onConflictDoUpdate({ target: drafts.id, set: { ciphertext, iv, encryptionVersion, updatedAt: now } })
    .returning()
  return NextResponse.json({ draft })
}

export async function DELETE(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await db.delete(drafts).where(eq(drafts.id, DRAFT_ID))
  return new NextResponse(null, { status: 204 })
}
