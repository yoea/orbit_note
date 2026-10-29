import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { credentials } from '@/lib/server/db/schema'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/ratelimit'
import { passkeyRenameSchema } from '@/lib/server/validation'

function parseId(param: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(param) ? param : null
}

// 禁用指定设备的通行密钥（软禁用）：凭证与 PRF wrapper 保留在库中，仅标记 disabled——
// 该设备下次认证即被拒绝，但可在设置页随时重新启用（不再物理删除）。
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  const { id } = await params
  if (!parseId(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const [updated] = await db.update(credentials).set({ disabled: true }).where(eq(credentials.id, id)).returning()
  if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return new NextResponse(null, { status: 204 })
}

// 改名（2026-10-29 用户要求：点列表里的设备名就地改，回车或勾提交、点空白处放弃）。
//
// 写回 `device` 列本身 —— 它原本只放「注册时客户端上报的设备标识」，现在同时是
// **用户可编辑的显示名**：列不动、无需迁移，列表接口也不用改（本来就下发 device）。
//
// ★ 只 set device：绝不碰 `lastUsedAt` / `createdAt` / `counter` ——
//   改名既不是登录（不该刷最近使用）也不是编辑（与 starred、archivedAt 同一条约定）。
// ★ 改过名之后登录接口不会覆盖它：login 只在 `stored.device == null` 时才补标。
// ★ 与软禁用（DELETE）共用同一条路径，不新增路由 ⇒ 无需登记 proxy matcher。
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  if (!rateLimit('passkey:rename', 30, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const { id } = await params
  if (!parseId(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const parsed = passkeyRenameSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const [updated] = await db
    .update(credentials)
    .set({ device: parsed.data.device })
    .where(eq(credentials.id, id))
    .returning()
  if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, device: updated.device })
}
