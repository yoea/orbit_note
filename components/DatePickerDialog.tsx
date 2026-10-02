'use client'

import { useState } from 'react'
import { DIALOG_FOOTER_BUTTON_CLASS } from '@/lib/client/ui'
import {
  dayKeyOf, jumpDayLabel, monthGrid, monthTitle, parseDayKey, shiftMonth, type DayKey,
} from '@/lib/client/date-jump'

// 月历日期选择弹层（列表页顶部日期胶囊打开）。
//
// 两个刻意的取舍：
// 1. **只有「有记录的日子」可点**。清单来自服务端全量聚合 stats.byDay（与组头统计、热力图
//    同一个数据源），没写过的日子与未来日期一律置灰。这与项目既有的「清单只列真实存在的
//    档位」是同一条约定（见 SearchDialog 的月份清单）——让用户点了才发现「这天没有」
//    是最没必要的一次挫败。
// 2. **网格固定 6 行**（lib/client/date-jump.ts 的 monthGrid）：5 行/6 行的月份切换时
//    弹窗高度不跳。
//
// 布局沿用项目弹窗的固定结构：遮罩 → 卡片（标题 / 唯一滚动区 / 底部整宽按钮）。
export default function DatePickerDialog({ byDay, selected, onSelect, onClose }: {
  /** 'yyyy-mm-dd' → 当天篇数（服务端全量聚合） */
  byDay: Record<string, { count: number }>
  /** 当前锚定的日期（null = 未锚定，即「全部」） */
  selected: DayKey | null
  onSelect: (day: DayKey) => void
  onClose: () => void
}) {
  const today = dayKeyOf(new Date())
  // 打开时定位到「当前选中月」，未选中则当月
  const [view, setView] = useState(() => {
    const base = (selected && parseDayKey(selected)) || new Date()
    return { year: base.getFullYear(), month: base.getMonth() + 1 }
  })

  const grid = monthGrid(view.year, view.month)
  // 该月是否有任何记录：用于给一句「这个月没有记录」，避免用户以为日历坏了
  const monthPrefix = `${view.year}-${String(view.month).padStart(2, '0')}`
  const monthHasRecord = Object.keys(byDay).some((k) => k.startsWith(monthPrefix))
  // 不能翻到未来月份（今天之后的月份没有意义）
  const atCurrentMonth = view.year === Number(today.slice(0, 4)) && view.month === Number(today.slice(5, 7))
  const canGoNext = !atCurrentMonth

  const go = (delta: number) => setView((v) => shiftMonth(v.year, v.month, delta))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={onClose}>
      <div
        className="flex w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="选择日期"
      >
        <h2 className="shrink-0 px-5 pb-1 pt-5 text-center text-base font-semibold">选择日期</h2>

        {/* 月份导航：年月分别可翻（跳几年前要按很多次「上月」，所以拆出「上一年」）。
            按钮 44px 见方用负 margin 抵消，视觉紧凑但触区达标。 */}
        <div className="flex shrink-0 items-center justify-between px-3 pt-1">
          <button onClick={() => go(-12)} aria-label="上一年" className="-ml-1 px-2 py-2 text-neutral-500 active:opacity-60 dark:text-neutral-400">«</button>
          <button onClick={() => go(-1)} aria-label="上个月" className="px-2 py-2 text-neutral-500 active:opacity-60 dark:text-neutral-400">‹</button>
          <span className="text-sm font-medium tabular-nums">{monthTitle(view.year, view.month)}</span>
          <button onClick={() => go(1)} disabled={!canGoNext} aria-label="下个月" className="px-2 py-2 text-neutral-500 active:opacity-60 disabled:opacity-30 dark:text-neutral-400">›</button>
          <button onClick={() => go(12)} disabled={!canGoNext} aria-label="下一年" className="-mr-1 px-2 py-2 text-neutral-500 active:opacity-60 disabled:opacity-30 dark:text-neutral-400">»</button>
        </div>

        {/* 唯一的滚动区（内容其实不会溢出，但保持一致的结构，超长语言/大字号下也不会顶破卡片） */}
        <div className="thin-scrollbar max-h-[60dvh] overflow-y-auto px-4 pb-1">
          <div className="grid grid-cols-7 gap-1 pb-1 pt-2 text-center text-[11px] text-neutral-500 dark:text-neutral-400">
            {['一', '二', '三', '四', '五', '六', '日'].map((w) => <span key={w}>{w}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1 pb-2">
            {grid.flat().map((day, i) => {
              if (day === null) return <span key={`e${i}`} />
              const count = byDay[day]?.count ?? 0
              const isFuture = day > today
              const disabled = count === 0 || isFuture
              const isSelected = day === selected
              return (
                <button
                  key={day}
                  onClick={() => { onSelect(day); onClose() }}
                  disabled={disabled}
                  aria-label={count > 0 ? `${jumpDayLabel(day, today)} · ${count} 篇` : jumpDayLabel(day, today)}
                  aria-current={day === today ? 'date' : undefined}
                  className={`relative flex aspect-square items-center justify-center rounded-lg text-sm tabular-nums ${
                    isSelected
                      ? 'bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 font-medium text-white'
                      : disabled
                        /* 不可点：标准的次级文字（WCAG AA 下限配对）。
                           刻意**不**做成「灰到看不见」——那正是 footnote-contrast 守卫拦下的写法
                           （浅色 neutral-300 只有 2.5:1），而对不可点元素用低对比度也不是好做法。 */
                        ? 'text-neutral-500 dark:text-neutral-400'
                        /* 可点：淡紫底 + 主色文字，一眼看出「这天有记录、能点」 */
                        : 'bg-violet-50 font-medium text-neutral-800 active:bg-violet-100 dark:bg-violet-500/10 dark:text-neutral-200 dark:active:bg-violet-500/20'
                  }`}
                >
                  {Number(day.slice(8, 10))}
                </button>
              )
            })}
          </div>
          {!monthHasRecord && (
            <p className="px-1 pb-3 text-center text-xs text-neutral-500 dark:text-neutral-400">这个月没有记录</p>
          )}
        </div>

        <button onClick={onClose} className={DIALOG_FOOTER_BUTTON_CLASS}>
          完成
        </button>
      </div>
    </div>
  )
}
