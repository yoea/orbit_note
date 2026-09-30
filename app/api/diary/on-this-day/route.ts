import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { requireAuth } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/ratelimit'

// 去年的今天：往年同月日的日记随机一篇（按笔记时区归日，与 stats 口径一致）；没有则返回 null。
// 首页顶部「去年的今天」卡片数据源。
export async function GET(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!rateLimit('on-this-day', 30, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const today = new Date()
  const rows = await db.execute(sql`
    SELECT id, ciphertext, iv, created_at, latitude,
           location_province, location_city, location_district, location_name
    FROM diary_entries
    WHERE EXTRACT(MONTH FROM created_at AT TIME ZONE COALESCE(timezone, 'UTC')) = ${today.getMonth() + 1}
      AND EXTRACT(DAY FROM created_at AT TIME ZONE COALESCE(timezone, 'UTC')) = ${today.getDate()}
      AND EXTRACT(YEAR FROM created_at AT TIME ZONE COALESCE(timezone, 'UTC')) < ${today.getFullYear()}
    ORDER BY random() LIMIT 1
  `) as unknown as Array<{
    id: string; ciphertext: string; iv: string; created_at: Date; latitude: number | null
    location_province: string | null; location_city: string | null
    location_district: string | null; location_name: string | null
  }>
  if (rows.length === 0) return NextResponse.json({ entry: null })
  const r = rows[0]
  return NextResponse.json({
    entry: {
      id: r.id,
      ciphertext: r.ciphertext,
      iv: r.iv,
      createdAt: r.created_at,
      latitude: r.latitude,
      locationProvince: r.location_province,
      locationCity: r.location_city,
      locationDistrict: r.location_district,
      locationName: r.location_name,
    },
  })
}
