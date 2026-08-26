import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { credentials, keyWrappers } from '@/lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { verifySessionToken } from '@/lib/server/session'
import { wrapperSchema } from '@/lib/server/validation'

// 注意：此 API 在 Task 7 会改为复用 lib/server/auth 的 isAuthed；本任务先内联
async function authed(req: Request): Promise<boolean> {
  const cookie = req.headers.get('cookie') ?? ''
  const token = cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith('qo_session='))?.split('=')[1]
  return token ? verifySessionToken(token) : false
}

export async function GET(req: Request) {
  if (!(await authed(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const wrappers = await db.select().from(keyWrappers)
  return NextResponse.json({ wrappers })
}

export async function POST(req: Request) {
  if (!(await authed(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = wrapperSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'bad_request', details: body.error.issues }, { status: 400 })
  const { wrapperType, credentialId, encryptedDek, salt, encryptionVersion, recoveryKeyHash } = body.data
  // passkey_prf 仅允许包裹已注册的 credential；recovery 需 credentialId 为 null
  if (wrapperType === 'passkey_prf') {
    const [cred] = await db.select().from(credentials).where(eq(credentials.credentialId, credentialId!))
    if (!cred) return NextResponse.json({ error: 'unknown_credential' }, { status: 400 })
  }
  await db.insert(keyWrappers).values({
    wrapperType,
    credentialId: wrapperType === 'passkey_prf' ? credentialId! : null,
    encryptedDek,
    salt,
    encryptionVersion,
    recoveryKeyHash: recoveryKeyHash ?? null,
  })
  return NextResponse.json({ ok: true }, { status: 201 })
}
