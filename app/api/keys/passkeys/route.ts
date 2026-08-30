import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { credentials } from '@/lib/server/db/schema'
import { desc } from 'drizzle-orm'
import { requireAuth } from '@/lib/server/auth'
import { getSessionCredential } from '@/lib/server/session'

// 通行密钥列表（设置页弹窗展示：设备名、注册/最近使用时间、凭证尾号）。
// 只返回展示所需字段——publicKey 等敏感材料永不下发。
// isCurrent：标注当前会话登录用的那把 key（恢复密钥登录的会话无凭证绑定 → 全 false）。
export async function GET(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const currentCredId = await getSessionCredential(req)
  const list = await db.select().from(credentials).orderBy(desc(credentials.createdAt))
  return NextResponse.json({
    passkeys: list.map((c) => ({
      id: c.id,
      device: c.device,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt,
      transports: c.transports,
      credentialIdTail: c.credentialId.slice(-8),
      disabled: c.disabled,
      isCurrent: currentCredId != null && c.credentialId === currentCredId,
    })),
  })
}
