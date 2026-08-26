import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { credentials, keyWrappers } from '@/lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { assertSameOrigin, isAuthed } from '@/lib/server/auth'
import { wrapperSchema } from '@/lib/server/validation'

export async function GET(req: Request) {
  if (!(await isAuthed(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const wrappers = await db.select().from(keyWrappers).orderBy(keyWrappers.createdAt)
  return NextResponse.json({ wrappers })
}

export async function POST(req: Request) {
  if (!(await isAuthed(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  const body = wrapperSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'bad_request', details: body.error.issues }, { status: 400 })
  const { wrapperType, credentialId, encryptedDek, salt, encryptionVersion, recoveryKeyHash } = body.data
  // passkey_prf 仅允许包裹已注册的 credential；recovery 需 credentialId 为 null
  if (wrapperType === 'passkey_prf') {
    const [cred] = await db.select().from(credentials).where(eq(credentials.credentialId, credentialId!))
    if (!cred) return NextResponse.json({ error: 'unknown_credential' }, { status: 400 })
  }
  // 幂等 upsert：按类型唯一键查重，存在则更新、不存在则插入
  const existing = wrapperType === 'passkey_prf'
    ? await db.select().from(keyWrappers).where(eq(keyWrappers.credentialId, credentialId!))
    : await db.select().from(keyWrappers).where(eq(keyWrappers.wrapperType, 'recovery'))
  const content = {
    encryptedDek,
    salt,
    encryptionVersion,
    recoveryKeyHash: recoveryKeyHash ?? null,
  }
  if (existing.length > 0) {
    await db.update(keyWrappers).set(content).where(eq(keyWrappers.id, existing[0].id))
  } else {
    await db.insert(keyWrappers).values({
      wrapperType,
      credentialId: wrapperType === 'passkey_prf' ? credentialId! : null,
      ...content,
    })
  }
  return NextResponse.json({ ok: true }, { status: 201 })
}
