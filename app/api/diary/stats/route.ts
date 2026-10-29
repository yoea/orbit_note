import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { requireAuth } from '@/lib/server/auth'

// 历史统计：总篇数 + 有笔记的日期数 + 按天篇数（写作频率热力图数据源）
// 按各条记录的写作时区归日（与列表分组口径一致）
//
// ★ 只统计**未归档**的日记（2026-10-29）：归档的语义就是「退出日常视图」，
//   热力图、连续写作天数、总篇数、字数都必须跟着退。否则「归档了却还在热力图上」
//   会显得不彻底，而连续写作天数更会算进用户已经收起来的那些天。
//   已知副作用（用户已确认接受）：某天唯一的一篇被归档 ⇒ 那天从热力图消失、连续天数可能断。
export async function GET(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const rows = await db.execute(
    sql`SELECT (created_at AT TIME ZONE COALESCE(timezone, 'UTC'))::date::text AS day,
               count(*)::int AS n,
               COALESCE(sum(word_count), 0)::int AS words
        FROM diary_entries
        WHERE archived_at IS NULL
        GROUP BY 1
        ORDER BY 1`,
  ) as unknown as { day: string; n: number; words: number }[]
  const byDay: Record<string, { count: number; words: number }> = {}
  for (const r of rows) byDay[r.day] = { count: r.n, words: r.words }
  const count = Object.values(byDay).reduce((a, b) => a + b.count, 0)
  return NextResponse.json({ count, days: Object.keys(byDay).length, byDay })
}
