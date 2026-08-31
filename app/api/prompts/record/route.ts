import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { promptStats } from '@/lib/server/db/schema'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/ratelimit'

// 记录每日提示的显示次数（upsert 自增）——供后续按出现频率展示
export async function POST(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  if (!rateLimit('prompt-record', 60, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const body = (await req.json().catch(() => null)) as { index?: unknown } | null
  const index = body?.index
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= 1000) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  await db.insert(promptStats).values({ promptId: `p_${index}`, showCount: 1 })
    .onConflictDoUpdate({
      target: promptStats.promptId,
      set: { showCount: sql`${promptStats.showCount} + 1`, updatedAt: new Date() },
    })
  return NextResponse.json({ ok: true })
}
