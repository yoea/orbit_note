import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { requireAuth } from '@/lib/server/auth'

// 历史统计：总篇数 + 有笔记的日期数（按各条记录的写作时区归日）
export async function GET(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const [row] = await db.execute(
    sql`SELECT count(*)::int AS count,
               count(DISTINCT (created_at AT TIME ZONE COALESCE(timezone, 'UTC'))::date)::int AS days
        FROM diary_entries`,
  )
  return NextResponse.json({ count: row?.count ?? 0, days: row?.days ?? 0 })
}
