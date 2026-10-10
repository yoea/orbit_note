import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { credentials, keyWrappers } from '@/lib/server/db/schema'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 「删除」通行密钥（**硬删除**）。与 `DELETE /api/keys/passkeys/[id]`（软禁用）成对：
//   · 软禁用：凭证保留、标记 disabled，可随时重新启用 —— 日常操作（「暂时不用这台设备」）；
//   · 硬删除：凭证连同它的 PRF wrapper 一起删掉 —— 「这把钥匙我永远不要了」。
//
// ★ 为什么必须**连 wrapper 一起删**：
//   1) 只删 credential 会留下一条**永远解不开**的 wrapper（它的 PRF 输出只存在于那把钥匙里）；
//   2) `key_wrappers` 上 `(wrapper_type, credential_id)` 有唯一索引 ⇒ 残留的脏行会让这类
//      「半截数据」越积越多，且 wrappers 的 upsert 语义会被它们干扰。
//
// ★ 路由参数 id 既接受 `credentials.id`（uuid —— 列表页用的就是它），也接受 `credentialId`
//   （base64url 字符串）：添加流程在「注册已成功但没跑完最后一步」时手上只有 credentialId，
//   会用它调这里做自清理（见 components/AddPasskeyPanel.tsx）。
//   ⚠️ 先按 uuid 形状分支再查询，**不能**把两种匹配塞进一个 `or()`：id 不是合法 uuid 时
//      PostgreSQL 会直接报 22P02 invalid input syntax for type uuid（本项目已踩过这个坑）。
//
// 不拦「删掉最后一把」：软禁用同样允许禁用最后一把（前端会给出强提示），
// 且只要 recovery wrapper 还在，就永远能用恢复密钥登录 —— 后端拦住反而制造「删不掉」的困惑。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const [cred] = UUID_RE.test(id)
    ? await db.select().from(credentials).where(eq(credentials.id, id))
    : await db.select().from(credentials).where(eq(credentials.credentialId, id))
  if (!cred) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await db.delete(keyWrappers).where(eq(keyWrappers.credentialId, cred.credentialId))
  await db.delete(credentials).where(eq(credentials.id, cred.id))
  return new NextResponse(null, { status: 204 })
}
