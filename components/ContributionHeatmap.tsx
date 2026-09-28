'use client'

// GitHub 风格写作频率热力图：列=周、行=周一至周日；当天篇数越多紫色越深（0-4 档）
// byDay: { 'yyyy-mm-dd': { count, words } }（服务端按笔记时区归日）
export default function ContributionHeatmap({ byDay }: { byDay: Record<string, { count: number; words: number }> }) {

  // 篇数 → 色阶档位（0=无记录）：1-16 篇每篇一档（16 级渐变，明显变色）；
  // 17-19篇→第5档（最深紫）；≥20篇→第6档（近乎黑）
  const levelOf = (n: number): number =>
    n <= 0 ? 0 : n >= 20 ? 6 : n <= 16 ? n : 5
  // 16 档紫色（品牌色系）：alpha 0.1 → 0.95 线性递进，相邻档差约 0.057（每篇一档明显可辨）
  const ALPHA = Array.from({ length: 16 }, (_, i) => (0.1 + (i * 0.85) / 15).toFixed(2))
  // 5 档（17-19 篇）：最深紫；6 档（≥20 篇）：近乎黑（深紫黑，深色模式下仍可区分）
  const NEAR_BLACK = '#3b0764'

  // 周一为一周开始（中国习惯）
  const startOfWeek = (d: Date): Date => {
    const s = new Date(d)
    s.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    s.setHours(0, 0, 0, 0)
    return s
  }
  const iso = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  // 周列范围：固定最近 26 周（半年）——26 列 ≈ 310px，手机一屏放下、无需横滚，
  // 配合 ml-auto 右对齐：打开即显示最新日期，零 JS 滚动零闪动。
  // 更早的日记在历史列表可见，不在此图范围内
  const today = new Date()
  const todayIso = iso(today)
  const halfYearAgo = new Date(today)
  halfYearAgo.setDate(halfYearAgo.getDate() - 25 * 7)
  const start = startOfWeek(halfYearAgo)
  const weeks: string[][] = []
  for (let d = new Date(start); d.getTime() <= today.getTime(); d.setDate(d.getDate() + 7)) {
    const week: string[] = []
    for (let i = 0; i < 7; i++) {
      const day = new Date(d)
      day.setDate(d.getDate() + i)
      week.push(iso(day))
    }
    weeks.push(week)
  }

  const emptyCellClass = 'bg-neutral-100 dark:bg-neutral-800'

  return (
    <div className="pb-4">
      {/* 26 周一屏放下，通常无需横滚；左对齐——半年图从左侧开始，视觉更自然 */}
      <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* pt-[3px]：为「今天」方块的 ring（向外 1px 的 box-shadow）留出空间——
            外层 overflow-x-auto 的 overflow-y 会被算作 auto 形成裁剪，顶部无内边距时
            最上面一行的描边会被裁掉。
            pb-5：为底部绝对定位的月份标签留出空间（不裁剪），同时也覆盖了最下一行的描边 */}
        <div className="flex w-max gap-[2px] pt-[3px] pb-5">
          {weeks.map((week, wi) => {
            // 每列底部月份小字：该列所属年月与上一列不同时显示（跨年同月也能正确标注）。
            // absolute 定位：不参与列宽计算——否则"10月/12月"两位数字会把列撑宽，
            // 导致不同月份的列距不一致
            const monthKey = week[0].slice(0, 7) // yyyy-mm
            const prevMonthKey = wi > 0 ? weeks[wi - 1][0].slice(0, 7) : ''
            const showMonth = monthKey !== prevMonthKey
            const month = parseInt(week[0].slice(5, 7), 10)
            return (
              <div key={wi} className="relative flex flex-col gap-[2px]">
                {week.map((day) => {
                  // 未来日期（今天之后）：不可见占位——保持列高与月份标签对齐，但不显示格子
                  if (day > todayIso) {
                    return <div key={day} className="invisible h-2.5 w-2.5 rounded-[3px]" />
                  }
                  const n = byDay[day]?.count ?? 0
                  const lvl = levelOf(n)
                  return (
                    <div
                      key={day}
                      title={n > 0 ? `${day} · ${n} 篇` : undefined}
                      className={`h-2.5 w-2.5 rounded-[3px] ${lvl === 0 ? emptyCellClass : ''} ${day === todayIso ? 'ring-1 ring-amber-400' : ''}`}
                      style={lvl > 0
                        ? { background: lvl === 6 ? NEAR_BLACK : `rgba(139, 92, 246, ${lvl === 5 ? '1' : ALPHA[lvl - 1]})` }
                        : undefined}
                    />
                  )
                })}
                {showMonth && (
                  <span className="absolute bottom-[-14px] left-0 whitespace-nowrap text-[8px] leading-none text-neutral-400">
                    {month}月
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
