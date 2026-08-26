import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { diaryEntries } from '@/lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/server/auth'
import { diaryUpdateSchema } from '@/lib/server/validation'

function parseId(param: string): string | null {
  return /^[0-9a-fA-F-]{36}$/.test(param) ? param : null
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // 规格第二十七节：所有日记 API 必须认证（计划原文 GET 遗漏，此处已补）
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  if (!parseId(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const [entry] = await db.select().from(diaryEntries).where(eq(diaryEntries.id, id))
  if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ entry })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  if (!parseId(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const body = diaryUpdateSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'bad_request', details: body.error.issues }, { status: 400 })
  const patch = body.data
  const [updated] = await db.update(diaryEntries)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(diaryEntries.id, id))
    .returning()
  if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ entry: updated })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  if (!parseId(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const [deleted] = await db.delete(diaryEntries).where(eq(diaryEntries.id, id)).returning()
  if (!deleted) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return new NextResponse(null, { status: 204 })
}
