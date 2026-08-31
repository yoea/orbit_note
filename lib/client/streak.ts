// 连续写作天数（Streak）：
// 今天有记录 → 从今天往前数；今天还没有但昨天有 → 从昨天往前数（今天未写不算断）；
// 否则为 0。byDay 来自 /api/diary/stats（服务端按笔记时区归日）。
export function computeStreak(
  byDay: Record<string, { count: number; words: number }>,
  today: Date,
): number {
  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const has = (d: Date) => Boolean(byDay[key(d)])

  let cursor = new Date(today)
  if (!has(cursor)) {
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    if (!has(yesterday)) return 0
    cursor = yesterday
  }
  let streak = 0
  while (has(cursor)) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}
