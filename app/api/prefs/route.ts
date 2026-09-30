import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { userPrefs } from '@/lib/server/db/schema'
import { assertSameOrigin, requireAuth } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/ratelimit'

// 偏好键白名单（防御：仅允许已知键，避免任意键污染表）。
// ★ 必须与 lib/client/prefs.ts 的 ALL_KEYS 保持同一集合（tests/prefs-keys.test.ts 对账）。
// 刻意不含的主题键 'qo-theme'：它值域是 'system'/'light'/'dark' 而非 '0'/'1'，
// 且外观是设备属性（不同步服务器）——见 prefs.ts 注释。
const PREF_KEYS = new Set([
  'qo-location-enabled',
  'qo-save-weather',
  'qo-show-streak',
  'qo-show-prompt',
  'qo-show-on-this-day',
  'qo-auto-place-name',
  'qo-save-sound',
  'qo-show-views',
  'qo-show-heatmap',
])

// 用户偏好（设置页开关）读写：多端同步，替代 localStorage
export async function GET(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const rows = await db.select().from(userPrefs)
  const prefs: Record<string, string> = {}
  for (const r of rows) prefs[r.key] = r.value
  return NextResponse.json({ prefs })
}

export async function PUT(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  if (!rateLimit('prefs', 60, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const body = (await req.json().catch(() => null)) as { key?: unknown; value?: unknown } | null
  const key = body?.key
  const value = body?.value
  if (typeof key !== 'string' || !PREF_KEYS.has(key) || (value !== '0' && value !== '1')) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  await db.insert(userPrefs).values({ key, value })
    .onConflictDoUpdate({
      target: userPrefs.key,
      set: { value, updatedAt: new Date() },
    })
  return NextResponse.json({ ok: true })
}
