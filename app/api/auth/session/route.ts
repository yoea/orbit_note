import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { credentials, keyWrappers } from '@/lib/server/db/schema'
import { isAuthed } from '@/lib/server/auth'

export async function GET(req: Request) {
  // isAuthed：JWT 验证 + 会话绑定凭证有效性（被禁用/删除 → 会话失效，前端踢回登录页）
  const authenticated = await isAuthed(req)

  const credentialCount = await db.select().from(credentials)
  const initialized = credentialCount.length > 0

  // 未认证调用方（登录页/守卫）只需要 initialized / authenticated 两个路由判断字段。
  // 凭证与包装的统计（credentialCount / hasRecoveryWrapper / prfWrappers）描述账号内部
  // 结构——未认证时返回等于向任意访客泄露「这个实例有几把通行密钥、是否配置了恢复通道」，
  // 对攻击者是免费的侦察信息。客户端确实没有任何代码在未认证状态下读取这三个字段。
  if (!authenticated) {
    return NextResponse.json({ initialized, authenticated: false })
  }

  const wrappers = await db.select().from(keyWrappers)
  return NextResponse.json({
    initialized,
    authenticated,
    credentialCount: credentialCount.length,
    hasRecoveryWrapper: wrappers.some((w) => w.wrapperType === 'recovery'),
    prfWrappers: wrappers.filter((w) => w.wrapperType === 'passkey_prf').length,
  })
}
