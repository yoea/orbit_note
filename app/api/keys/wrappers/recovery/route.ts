import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { keyWrappers } from '@/lib/server/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/ratelimit'
import { z } from 'zod'

const schema = z.object({
  encryptedDek: z.string().min(1).max(2048),
  salt: z.string().min(1).max(256),
  encryptionVersion: z.number().int().min(1).max(10).default(1),
  recoveryKeyHash: z.string().length(64).regex(/^[0-9a-f]+$/),
})

// 更新 recovery wrapper（重新生成恢复密钥时由客户端调用，需先验证旧密钥——客户端先用旧密钥解开 wrapper 才允许 PUT）
export async function PUT(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  if (!rateLimit('recovery-update', 5, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const body = schema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const { encryptedDek, salt, encryptionVersion, recoveryKeyHash } = body.data
  const [existing] = await db.select().from(keyWrappers).where(and(eq(keyWrappers.wrapperType, 'recovery'), isNull(keyWrappers.credentialId)))
  if (!existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  await db.update(keyWrappers)
    // createdAt 一并刷新：换新后这行的 created_at 语义 = 「当前这把密钥的创建时刻」，
    // 前端「恢复密钥」弹窗据此展示；不刷的话重生成后时间永远停在首次初始化（误导）。
    // 只有 recovery 行会整行换内容，passkey 行不受本接口影响。
    .set({ encryptedDek, salt, encryptionVersion, recoveryKeyHash, createdAt: new Date() })
    .where(eq(keyWrappers.id, existing.id))
  return NextResponse.json({ ok: true })
}
