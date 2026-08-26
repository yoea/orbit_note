import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { credentials } from '@/lib/server/db/schema'
import { rateLimit } from '@/lib/server/ratelimit'
import { generateRegisterOptions, storeChallenge } from '@/lib/server/webauthn'
import { SESSION_COOKIE } from '@/lib/server/session'

export async function GET(req: Request) {
  if (!rateLimit('register-options', 5, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const existing = await db.select().from(credentials).limit(1)
  // 已初始化：注册仅允许已登录用户在设置页添加新 Passkey
  const authenticated = req.headers.get('cookie')?.includes(`${SESSION_COOKIE}=`) ?? false
  if (existing.length > 0 && !authenticated) {
    return NextResponse.json({ error: 'already_initialized' }, { status: 403 })
  }
  const { token, challenge } = storeChallenge('register')
  const options = await generateRegisterOptions()
  // 用我们存储的 challenge 覆盖库生成的（保证与验证时一致）
  return NextResponse.json({ token, options: { ...options, challenge } })
}
