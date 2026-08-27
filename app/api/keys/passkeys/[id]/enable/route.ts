import { NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { credentials } from '@/lib/server/db/schema'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'

function parseId(param: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(param) ? param : null
}

// 重新启用被禁用的通行密钥（软禁用的逆向操作）
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  const { id } = await params
  if (!parseId(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const [updated] = await db.update(credentials).set({ disabled: false }).where(and(eq(credentials.id, id), isNull(credentials.deletedAt))).returning()
  if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return new NextResponse(null, { status: 204 })
}
