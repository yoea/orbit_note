import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { credentials } from '@/lib/server/db/schema'
import { rateLimit } from '@/lib/server/ratelimit'
import { generateRegisterOptions, storeChallenge } from '@/lib/server/webauthn'
import { isAuthed } from '@/lib/server/auth'

export async function GET(req: Request) {
  if (!rateLimit('register-options', 5, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const existing = await db.select().from(credentials).limit(1)
  // 已初始化：注册仅允许已登录用户在设置页添加新 Passkey。
  // 必须完整验证 JWT（isAuthed）——仅检查 cookie 字符串包含可被伪造 cookie 绕过
  // （攻击者借此完成注册获得合法 session 后即可调用 wipe 删除全部数据）
  if (existing.length > 0 && !(await isAuthed(req))) {
    return NextResponse.json({ error: 'already_initialized' }, { status: 403 })
  }
  const { token, challenge } = storeChallenge('register')
  const options = await generateRegisterOptions()
  // 用我们存储的 challenge 覆盖库生成的（保证与验证时一致）
  return NextResponse.json({ token, options: { ...options, challenge } })
}
