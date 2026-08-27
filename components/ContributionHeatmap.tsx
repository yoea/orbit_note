'use client'

import { useEffect, useRef } from 'react'

// GitHub 风格写作频率热力图：列=周、行=周一至周日；当天篇数越多紫色越深（0-4 档）
// byDay: { 'yyyy-mm-dd': 篇数 }（服务端按笔记时区归日）
export default function ContributionHeatmap({ byDay }: { byDay: Record<string, number> }) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // 篇数 → 色阶档位（0=无记录）
  const levelOf = (n: number): number => (n <= 0 ? 0 : n >= 7 ? 4 : n >= 4 ? 3 : n >= 2 ? 2 : 1)
  // 4 档紫色（品牌色系），透明度递进
  const ALPHA = ['0.25', '0.5', '0.75', '1']

  // 周一为一周开始（中国习惯）
  const startOfWeek = (d: Date): Date => {
    const s = new Date(d)
    s.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    s.setHours(0, 0, 0, 0)
    return s
  }
  const iso = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  // 周列范围：从最早有记录的日期所在周的周一开始，到本周
  const today = new Date()
  let start = startOfWeek(today)
  const dates = Object.keys(byDay).sort()
  if (dates.length > 0) {
    const first = new Date(`${dates[0]}T00:00:00`)
    if (first.getTime() < start.getTime()) start = startOfWeek(first)
  }
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

  // 默认滚到最右（最近一周），而不是从最早开始
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [])

  const emptyCellClass = 'bg-neutral-100 dark:bg-neutral-800'
  const legendCells = [
    emptyCellClass,
    `rgba(139, 92, 246, ${ALPHA[0]})`,
    `rgba(139, 92, 246, ${ALPHA[1]})`,
    `rgba(139, 92, 246, ${ALPHA[2]})`,
    `rgba(139, 92, 246, ${ALPHA[3]})`,
  ]

  return (
    <div className="pb-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-neutral-400">写作频率</p>
        <div className="flex items-center gap-1 text-[10px] text-neutral-400">
          <span>少</span>
          {legendCells.map((bg, i) => (
            <span
              key={i}
              className={`h-2.5 w-2.5 rounded-[3px] ${bg === emptyCellClass ? emptyCellClass : ''}`}
              style={bg === emptyCellClass ? undefined : { background: bg }}
            />
          ))}
          <span>多</span>
        </div>
      </div>
      {/* 横滚查看更早的记录；滚动条隐藏（内容 w-max 撑开，列数=周数） */}
      <div
        ref={scrollRef}
        className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex w-max gap-[2px]">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[2px]">
              {week.map((day) => {
                const n = byDay[day] ?? 0
                const lvl = levelOf(n)
                return (
                  <div
                    key={day}
                    title={n > 0 ? `${day} · ${n} 篇` : undefined}
                    className={`h-2.5 w-2.5 rounded-[3px] ${lvl === 0 ? emptyCellClass : ''}`}
                    style={lvl > 0 ? { background: `rgba(139, 92, 246, ${ALPHA[lvl - 1]})` } : undefined}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
