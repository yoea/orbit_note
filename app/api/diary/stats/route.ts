import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { requireAuth } from '@/lib/server/auth'

// 历史统计：总篇数 + 有笔记的日期数 + 按天篇数（写作频率热力图数据源）
// 按各条记录的写作时区归日（与列表分组口径一致）
//
// 默认只统计**未归档**的日记（2026-10-29）：归档的语义就是「退出日常视图」，
// 热力图、连续写作天数、总篇数、字数都必须跟着退。
//
// ★ `?includeArchived=1` 可以把这个口径翻过来（偏好「归档计入统计」）。
//   为什么是**查询参数**而不是服务端读偏好：偏好存的是"这台设备想怎么看"，
//   而 stats 是纯聚合。让客户端明确说出它要哪个口径，服务端不猜。
//   代价是任何调用方都能要全量 —— 单用户私人应用，统计只是展示，可以接受。
export async function GET(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // 布尔参数直接进 SQL：比拼两个版本的 SQL 字符串安全（也不会忘掉某一处）
  const includeArchived = new URL(req.url).searchParams.get('includeArchived') === '1'
  const rows = await db.execute(
    sql`SELECT (created_at AT TIME ZONE COALESCE(timezone, 'UTC'))::date::text AS day,
               count(*)::int AS n,
               COALESCE(sum(word_count), 0)::int AS words
        FROM diary_entries
        WHERE (${includeArchived}::boolean OR archived_at IS NULL)
        GROUP BY 1
        ORDER BY 1`,
  ) as unknown as { day: string; n: number; words: number }[]
  const byDay: Record<string, { count: number; words: number }> = {}
  for (const r of rows) byDay[r.day] = { count: r.n, words: r.words }
  const count = Object.values(byDay).reduce((a, b) => a + b.count, 0)
  return NextResponse.json({ count, days: Object.keys(byDay).length, byDay })
}
