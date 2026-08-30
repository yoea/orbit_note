import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { requireAuth } from '@/lib/server/auth'

// 历史统计：总篇数 + 有笔记的日期数 + 按天篇数（写作频率热力图数据源）
// 按各条记录的写作时区归日（与列表分组口径一致）
export async function GET(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const rows = await db.execute(
    sql`SELECT (created_at AT TIME ZONE COALESCE(timezone, 'UTC'))::date::text AS day,
               count(*)::int AS n,
               COALESCE(sum(word_count), 0)::int AS words
        FROM diary_entries
        GROUP BY 1
        ORDER BY 1`,
  ) as unknown as { day: string; n: number; words: number }[]
  const byDay: Record<string, { count: number; words: number }> = {}
  for (const r of rows) byDay[r.day] = { count: r.n, words: r.words }
  const count = Object.values(byDay).reduce((a, b) => a + b.count, 0)
  return NextResponse.json({ count, days: Object.keys(byDay).length, byDay })
}
