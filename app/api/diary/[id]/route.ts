import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { diaryEntries } from '@/lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { diaryUpdateSchema } from '@/lib/server/validation'

/** 结构化地名三级：写入其中任意一级都意味着「地名换成了结构化口径」，见下面的 set.locationName = null */
const PLACE_FIELDS = ['locationProvince', 'locationCity', 'locationDistrict'] as const

function parseId(param: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(param) ? param : null
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
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  const { id } = await params
  if (!parseId(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const body = diaryUpdateSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'bad_request', details: body.error.issues }, { status: 400 })
  const patch = body.data
  const set: Record<string, unknown> = { ...patch }
  // 仅内容编辑（ciphertext/iv 成对出现）才更新"编辑时间"；纯元数据更新
  // （补地点名、改收藏状态）不算编辑——详情页不会显示"编辑于"
  if (patch.ciphertext !== undefined) set.updatedAt = new Date()
  // 用户移除坐标 → 地点相关字段一并清除（结构化三级与旧的单一地名串都不留孤值）
  if (patch.latitude === null) {
    set.locationName = null
    set.locationProvince = null
    set.locationCity = null
    set.locationDistrict = null
  } else if (PLACE_FIELDS.some((k) => patch[k] !== undefined) && patch.locationName === undefined) {
    // 结构化三级已给出 ⇒ 旧的单一地名串作废（否则同一篇会同时存在两套地名，展示口径分裂：
    // 展示层以结构化优先，这列留着就只是永远不会被读到的陈旧数据）。
    set.locationName = null
  }
  const [updated] = await db.update(diaryEntries)
    .set(set)
    .where(eq(diaryEntries.id, id))
    .returning()
  if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ entry: updated })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  const { id } = await params
  if (!parseId(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const [deleted] = await db.delete(diaryEntries).where(eq(diaryEntries.id, id)).returning()
  if (!deleted) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return new NextResponse(null, { status: 204 })
}
