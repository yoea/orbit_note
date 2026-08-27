import { NextResponse } from 'next/server'
import { isNotNull, isNull } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { credentials, keyWrappers } from '@/lib/server/db/schema'
import { isAuthed } from '@/lib/server/auth'
import { purgeExpiredWipes, WIPE_GRACE_MS } from '@/lib/server/pending-wipe'

export async function GET(req: Request) {
  // 惰性清理（未登录入口也触发——删除后用户重新打开 app 的第一步就是这里）
  await purgeExpiredWipes()

  // isAuthed：JWT 验证 + 会话绑定凭证有效性（被禁用/删除 → 会话失效，前端踢回登录页）
  const authenticated = await isAuthed(req)

  // 软删过滤：删除冷静期内的数据不计入（已对用户不可见）
  const credentialRows = await db.select().from(credentials).where(isNull(credentials.deletedAt))
  const wrappers = await db.select().from(keyWrappers).where(isNull(keyWrappers.deletedAt))
  // 冷静期状态（设置页据此显示"撤销删除 + 倒计时"）——以 key_wrappers 标记为准
  // （credentials 冷静期内故意不标记，保留登录入口）
  const [pending] = await db.select({ deletedAt: keyWrappers.deletedAt }).from(keyWrappers).where(isNotNull(keyWrappers.deletedAt)).limit(1)

  return NextResponse.json({
    initialized: credentialRows.length > 0,
    authenticated,
    credentialCount: credentialRows.length,
    hasRecoveryWrapper: wrappers.some((w) => w.wrapperType === 'recovery'),
    prfWrappers: wrappers.filter((w) => w.wrapperType === 'passkey_prf').length,
    pendingWipe: pending?.deletedAt ? { deletedAt: pending.deletedAt, graceMs: WIPE_GRACE_MS } : null,
  })
}
