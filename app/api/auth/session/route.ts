import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { credentials, keyWrappers } from '@/lib/server/db/schema'
import { verifySessionToken } from '@/lib/server/session'

export async function GET(req: Request) {
  const cookie = req.headers.get('cookie') ?? ''
  const token = cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith('qo_session='))?.split('=')[1]
  const authenticated = token ? await verifySessionToken(token) : false

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
