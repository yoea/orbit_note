import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { keyWrappers } from '@/lib/server/db/schema'
import { rateLimit } from '@/lib/server/ratelimit'
import { generateLoginOptions, storeChallenge } from '@/lib/server/webauthn'

export async function GET() {
  if (!rateLimit('login-options', 10, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  // allowCredentials 传空数组（discoverable credential 流程）：
  // iOS 对"非空 allowCredentials + 单通行密钥"会跳过选择、直接自动触发 Face ID（弹窗出现即识别，
  // 无用户操作时识别无效）；空数组时 iOS 唤起系统通行密钥半屏，用户点击后系统才唤醒 Face ID——
  // 符合"只唤起半屏、由用户操作"的体验。认证后服务器仍按 assertion.id 校验 credential 存在性与签名。
  const { token, challenge } = storeChallenge('login')
  const options = await generateLoginOptions([])
  // PRF eval 输入 S：从任意 passkey_prf wrapper 的 salt 读取（S 对所有 passkey 一致，不属于敏感材料）
  // 固化不变量：所有 passkey 必须共用同一个 PRF eval 输入 S（即第一个 wrapper 的 salt）。
  // 后续注册新 Passkey（Task 13 设置页）必须复用该 S，不得生成新的——否则新 wrapper_p 的 KEK
  // 与登录时基于 S 派生的 PRF 输出无法匹配。
  const [anyPrf] = await db.select().from(keyWrappers).where(eq(keyWrappers.wrapperType, 'passkey_prf')).orderBy(keyWrappers.createdAt).limit(1)
  return NextResponse.json({ token, options: { ...options, challenge }, prfEval: anyPrf?.salt ?? null })
}
