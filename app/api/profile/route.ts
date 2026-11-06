import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { userProfile } from '@/lib/server/db/schema'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/ratelimit'
import { PROFILE_OWNER_ID, profilePutSchema } from '@/lib/server/validation'

// 用户名读写。名字是可识别身份的信息，由客户端用 DEK 加密后上传，
// 服务器只存密文——与日记正文同等级别保护，数据库泄露也不会暴露「这本日记属于谁」。

export async function GET(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const [row] = await db.select().from(userProfile).where(eq(userProfile.id, PROFILE_OWNER_ID))
  // 未设置过（行不存在或字段为空）→ 返回 null，由客户端生成默认名后回写
  const profile = row?.nameCiphertext && row.nameIv
    ? { nameCiphertext: row.nameCiphertext, nameIv: row.nameIv }
    : null
  // 注册时间（明文时间戳，不含身份信息）：仅首次注册时写入；
  // 老用户为 null，界面回退为「第一篇日记」的日期
  //
  // 头像只回版本号（毫秒时间戳）：图片本体走同源 GET /api/avatar?v=<version>。
  // ★ 这里刻意不碰 OSS：① 现签的 URL 每次都不同，浏览器 HTTP 缓存按完整 URL 做键，
  //   永远命中不了，刷新就必然重新下载 ⇒ 头像闪一下；② OSS 没配/抖动时名字照样能读。
  // 客户端把 version 同步存进 localStorage，首帧就能拼出稳定 URL，不必等这个请求。
  const avatar = row?.avatarKey
    ? { version: (row.avatarUpdatedAt ?? row.updatedAt).getTime() }
    : null
  return NextResponse.json({ profile, createdAt: row?.createdAt ?? null, avatar })
}

export async function PUT(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  if (!rateLimit('profile', 30, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const body = profilePutSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const { nameCiphertext, nameIv } = body.data
  await db.insert(userProfile)
    .values({ id: PROFILE_OWNER_ID, nameCiphertext, nameIv })
    .onConflictDoUpdate({
      target: userProfile.id,
      set: { nameCiphertext, nameIv, updatedAt: new Date() },
    })
  return NextResponse.json({ ok: true })
}
