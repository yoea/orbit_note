import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { userProfile } from '@/lib/server/db/schema'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/ratelimit'
import { PROFILE_OWNER_ID } from '@/lib/server/validation'
import { assetKey, deleteObject, putObject, signedUrl } from '@/lib/server/oss'

// 头像：上传 / 删除。
//
// ── 为什么走服务端中转，而不是浏览器直传 OSS ──────────────────────────────
// 客户端已经把图裁到 256×256、压成 WebP（约 20KB），过一遍 ECS 是毫秒级；
// 而直传要多付两笔代价：配 CORS、把 AccessKeyId 暴露到前端去签 policy。
// 20KB 的量级上，中转换来「零 CORS + AK 只留在服务器」，明显更划算。
// （如果以后要传几 MB 的原图，那时再改直传。）
//
// ── 校验 ────────────────────────────────────────────────────────────────
// 收 WebP / JPEG / PNG。客户端已经压过一次，这里再兜一道：
// 前端可以被绕过，别让它变成「往 bucket 里塞任意大文件」的入口。
//
// ★ 为什么必须收 PNG（2026-11-04 真机事故：上传永远失败）：
//   iOS Safari 在**不支持 WebP 编码**时，`canvas.toBlob(cb, 'image/webp')` 不会返回 null，
//   而是按 HTML 规范**降级成 PNG**。只放行 webp/jpeg ⇒ 每次上传都 415。
//   PNG 比 WebP 大，所以上限从 200KB 提到 400KB（256×256 的照片 PNG 约 100~250KB）。
const MAX_BYTES = 400 * 1024
const ALLOWED_TYPES = ['image/webp', 'image/jpeg', 'image/png']

export async function POST(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  // 头像是手动操作，一分钟 10 次足够（也挡住了「把 bucket 当免费图床」的滥用）
  if (!rateLimit('avatar', 10, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: 'unsupported_type' }, { status: 415 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const key = assetKey('avatar')

  try {
    await putObject(key, buffer, file.type)
  } catch {
    // 不把 OSS 的原始错误回给前端（可能带 endpoint / bucket 等内部信息）
    return NextResponse.json({ error: 'upload_failed' }, { status: 502 })
  }

  const updatedAt = new Date()
  await db.insert(userProfile)
    .values({ id: PROFILE_OWNER_ID, avatarKey: key, avatarUpdatedAt: updatedAt })
    .onConflictDoUpdate({
      target: userProfile.id,
      set: { avatarKey: key, avatarUpdatedAt: updatedAt, updatedAt },
    })

  // 直接回签名 URL：客户端拿到就能显示，不用再打一次 /api/profile
  return NextResponse.json({
    avatarUrl: signedUrl(key),
    avatarVersion: updatedAt.getTime(),
  })
}

export async function DELETE(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  if (!rateLimit('avatar', 10, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })

  const [row] = await db.select({ key: userProfile.avatarKey }).from(userProfile).where(eq(userProfile.id, PROFILE_OWNER_ID))
  const key = row?.key ?? null

  // 先清库再删对象：库清掉后界面立刻回到首字母头像，
  // 对象删除失败最多留一个孤儿文件（几 KB），不影响使用。
  await db.insert(userProfile)
    .values({ id: PROFILE_OWNER_ID, avatarKey: null, avatarUpdatedAt: null })
    .onConflictDoUpdate({
      target: userProfile.id,
      set: { avatarKey: null, avatarUpdatedAt: null, updatedAt: new Date() },
    })

  if (key) {
    try { await deleteObject(key) } catch { /* 孤儿对象无害，静默 */ }
  }
  return NextResponse.json({ ok: true })
}
