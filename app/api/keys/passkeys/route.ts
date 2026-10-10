import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { credentials, keyWrappers } from '@/lib/server/db/schema'
import { desc, eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/server/auth'
import { getSessionCredential } from '@/lib/server/session'

// 通行密钥列表（设置页弹窗展示：设备名、注册/最近使用时间、凭证尾号）。
// 只返回展示所需字段——publicKey 等敏感材料永不下发。
// isCurrent：标注当前会话登录用的那把 key（恢复密钥登录的会话无凭证绑定 → 全 false）。
// ready：这把钥匙是否有对应的 PRF wrapper（即**是否真的能解开日记**）。
//   ★ 注册流程是「先注册凭据 → 再认证一次拿 PRF 输出 → 存 wrapper」三段。用户在第三段
//     放弃/失败（比如认证弹窗被取消、网络断），库里就会留下一把「有凭据、无 wrapper」的
//     半截钥匙：用它认证会成功，但永远解不开 DEK —— 表现就是「验证之后没反应」。
//     这类凭据在列表里标成「未完成」，并允许直接删除（purge）。
export async function GET(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const currentCredId = await getSessionCredential(req)
  const [list, prfWrappers] = await Promise.all([
    db.select().from(credentials).orderBy(desc(credentials.createdAt)),
    db.select({ credentialId: keyWrappers.credentialId }).from(keyWrappers).where(eq(keyWrappers.wrapperType, 'passkey_prf')),
  ])
  const readyIds = new Set(prfWrappers.map((w) => w.credentialId))
  return NextResponse.json({
    passkeys: list.map((c) => ({
      id: c.id,
      device: c.device,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt,
      transports: c.transports,
      credentialIdMasked: c.credentialId.length > 6 ? `${c.credentialId.slice(0, 3)}*****${c.credentialId.slice(-3)}` : c.credentialId, // 掩码：前3+5星+后3
      disabled: c.disabled,
      ready: readyIds.has(c.credentialId),
      isCurrent: currentCredId != null && c.credentialId === currentCredId,
    })),
  })
}
