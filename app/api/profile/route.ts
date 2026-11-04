import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { userProfile } from '@/lib/server/db/schema'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/ratelimit'
import { PROFILE_OWNER_ID, profilePutSchema } from '@/lib/server/validation'
import { signedUrl } from '@/lib/server/oss'

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
  // 头像：bucket 是私有的，这里每次现签一个 24 小时有效的 URL 给前端 <img>。
  // ★ 包在 try 里：OSS 没配 / 短暂不可用时，**名字照样要能读**（头像只是锦上添花）。
  let avatar: { url: string; version: number } | null = null
  if (row?.avatarKey) {
    try {
      avatar = {
        url: signedUrl(row.avatarKey),
        // 版本号：固定 key 覆盖写，前端拿它拼 ?v= 破缓存
        version: (row.avatarUpdatedAt ?? row.updatedAt).getTime(),
      }
    } catch { /* 未配置 OSS：当作没有头像 */ }
  }
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
