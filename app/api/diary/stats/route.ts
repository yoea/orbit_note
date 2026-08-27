import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { requireAuth } from '@/lib/server/auth'

// 历史统计：总篇数 + 有笔记的日期数 + 按天篇数（写作频率热力图数据源）
// 按各条记录的写作时区归日（与列表分组口径一致）；软删过滤（冷静期内不计）
export async function GET(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const rows = await db.execute(
    sql`SELECT (created_at AT TIME ZONE COALESCE(timezone, 'UTC'))::date::text AS day,
               count(*)::int AS n
        FROM diary_entries
        WHERE deleted_at IS NULL
        GROUP BY 1
        ORDER BY 1`,
  ) as unknown as { day: string; n: number }[]
  const byDay: Record<string, number> = {}
  for (const r of rows) byDay[r.day] = r.n
  const count = Object.values(byDay).reduce((a, b) => a + b, 0)
  return NextResponse.json({ count, days: Object.keys(byDay).length, byDay })
}
