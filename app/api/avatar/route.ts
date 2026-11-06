import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { userProfile } from '@/lib/server/db/schema'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/ratelimit'
import { PROFILE_OWNER_ID } from '@/lib/server/validation'
import { assetKey, deleteObject, getObject, putObject } from '@/lib/server/oss'

// 头像：读（同源图片代理）/ 上传 / 删除。
//
// ── 为什么走服务端中转，而不是浏览器直传 OSS ──────────────────────────────
// 客户端已经把图裁到 256×256、压成 JPEG（约 20~40KB），过一遍 ECS 是毫秒级；
// 而直传要多付两笔代价：配 CORS、把 AccessKeyId 暴露到前端去签 policy。
// 20KB 的量级上，中转换来「零 CORS + AK 只留在服务器」，明显更划算。
// （如果以后要传几 MB 的原图，那时再改直传。）
//
// ── 为什么读也走同源，而不是给 <img> 一个签名 URL（2026-11-06）──────────
// 之前每次 GET /api/profile 都现签一个 24h URL：URL 里的 Expires / Signature
// 每次都变 ⇒ 浏览器 HTTP 缓存按完整 URL 做键，永远命中不了 ⇒ 每次刷新/进设置页
// 都要重新下载图片，加上首帧还要等 /api/profile 返回，表现就是「头像闪一下」。
// 现在：URL 恒为 `/api/avatar?v=<avatarUpdatedAt>`，只有换图才变；响应带
// immutable 缓存头，浏览器在刷新时直接读磁盘缓存，连条件请求都不发。
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

/**
 * 头像图片本体（同源 GET）。URL 恒为 `/api/avatar?v=<version>`：
 * 只有换图时 version 才变，URL 一变浏览器自然重新取；没换图时靠 immutable 头
 * 直接读磁盘缓存，连协商请求都不发。SW 对 /api/ 一律不介入（见 public/sw.js）。
 */
export async function GET(req: Request) {
  if (!(await requireAuth(req))) return new Response(null, { status: 401 })
  if (!assertSameOrigin(req)) return new Response(null, { status: 403 })
  // 缓存命中后极少真的打到服务器；60/min 只是防有人拿它刷 OSS 读取
  if (!rateLimit('avatar-image', 60, 60_000)) return new Response(null, { status: 429 })

  const [row] = await db.select({
    key: userProfile.avatarKey,
    updatedAt: userProfile.avatarUpdatedAt,
  }).from(userProfile).where(eq(userProfile.id, PROFILE_OWNER_ID))
  if (!row?.key) return new Response(null, { status: 404 })

  let asset: { body: Buffer; contentType: string }
  try {
    asset = await getObject(row.key)
  } catch {
    // 不把 OSS 的原始错误回给前端（可能带 endpoint / bucket 等内部信息）
    return new Response(null, { status: 502 })
  }
  const version = (row.updatedAt ?? new Date(0)).getTime()
  return new Response(new Uint8Array(asset.body), {
    headers: {
      'Content-Type': asset.contentType,
      // ★ immutable 是「刷新不闪」的关键：普通刷新直接用缓存，不等网络。
      //   private 保证不进共享代理；内容变化靠 v= 换 URL，不会读到旧图。
      'Cache-Control': 'private, max-age=31536000, immutable',
      ETag: `"${version}"`,
    },
  })
}

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

  // 只回版本号：客户端拿它拼稳定 URL 并同步持久化，不必再打一次 /api/profile。
  // ★ 不再回签名 URL —— 每次不同的地址会让浏览器 HTTP 缓存永远失效。
  return NextResponse.json({ avatarVersion: updatedAt.getTime() })
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
