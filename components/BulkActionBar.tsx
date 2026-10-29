'use client'

// 批量操作条（2026-10-29，阶段 4）：列表页与归档页共用。
//
// 位置：**在滚动容器之外、main 的最底部**（`shrink-0`），不是 `fixed`。
// 为什么不用 fixed：本应用的 TabBar 在文档流内（(app)/layout 的 flex 列），
// 一个 fixed 操作条会直接盖住它 —— 而 TabBar 是离开这个页面的唯一出口。
// 放在流内时，选择态出现会把列表区压矮一点，这是可接受的（而且看得出来"进入了另一个模式"）。
//
// 样式刻意与主按钮（PRIMARY_BUTTON_CLASS 的整条渐变大按钮）不同：
// 这里是**一个模式里的确认动作**，不是这一屏的主角；用中性深底小按钮，
// 不给它和「保存」同等的视觉重量。
export default function BulkActionBar({ count, busy, label, busyLabel, onAction, onCancel }: {
  count: number
  busy: boolean
  /** 主操作文案：「归档」/「取消归档」 */
  label: string
  /** 进行中文案 */
  busyLabel: string
  onAction: () => void
  onCancel: () => void
}) {
  return (
    <div className="shrink-0 border-t border-neutral-100 bg-white px-5 py-3 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-sm tabular-nums text-neutral-500 dark:text-neutral-400">
          已选 {count} 篇
        </span>
        <span className="flex-1" aria-hidden />
        <button
          onClick={onCancel}
          disabled={busy}
          className="shrink-0 rounded-xl px-4 py-2.5 text-sm text-neutral-500 active:opacity-60 disabled:opacity-40 dark:text-neutral-400"
        >
          取消
        </button>
        <button
          onClick={onAction}
          disabled={count === 0 || busy}
          /* 深色模式**不**做成「白底深字」的反转块：footnote-contrast 的 R2 禁止 dark:text-neutral-5xx
             及更深，而那条守卫按 token 判、看不到 dark:bg-white 这个上下文。与其为一块按钮放宽守卫，
             不如两端都用「实心底 + 白字」：浅色 neutral-800、深色 neutral-600，对比度都在 7:1 以上。 */
          className="shrink-0 rounded-xl bg-neutral-800 px-5 py-2.5 text-sm font-medium text-white transition-colors active:opacity-80 disabled:opacity-40 dark:bg-neutral-600 dark:text-white"
        >
          {busy ? busyLabel : label}
        </button>
      </div>
    </div>
  )
}
