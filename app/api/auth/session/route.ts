import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { credentials, keyWrappers } from '@/lib/server/db/schema'
import { isAuthed } from '@/lib/server/auth'

export async function GET(req: Request) {
  // isAuthed：JWT 验证 + 会话绑定凭证有效性（被禁用/删除 → 会话失效，前端踢回登录页）
  const authenticated = await isAuthed(req)

  const credentialCount = await db.select().from(credentials)
  const wrappers = await db.select().from(keyWrappers)
  return NextResponse.json({
    initialized: credentialCount.length > 0,
    authenticated,
    credentialCount: credentialCount.length,
    hasRecoveryWrapper: wrappers.some((w) => w.wrapperType === 'recovery'),
    prfWrappers: wrappers.filter((w) => w.wrapperType === 'passkey_prf').length,
  })
}
