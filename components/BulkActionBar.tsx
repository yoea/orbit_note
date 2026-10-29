'use client'

// 批量操作条（2026-10-29）：列表页与归档页共用。
//
// 位置：**在滚动容器之外、main 的最底部**（`shrink-0`），不是 `fixed`。
// 为什么不用 fixed：本应用的 TabBar 在文档流内（(app)/layout 的 flex 列），
// 一个 fixed 操作条会直接盖住它 —— 而 TabBar 是离开这个页面的唯一出口。
// 放在流内时，选择态出现会把列表区压矮一点，这是可接受的（而且看得出来"进入了另一个模式"）。
//
// 样式刻意与主按钮（PRIMARY_BUTTON_CLASS 的整条渐变大按钮）不同：
// 这里是**一个模式里的确认动作**，不是这一屏的主角。
// 「删除」用红字而不是红底：红底块在整个应用里等于"最危险的那一步"，
// 而这里只是打开一个确认弹窗 —— 真正的不可逆动作在弹窗里才发生。
export default function BulkActionBar({
  count, busy, label, busyLabel, dangerLabel, onAction, onDanger, onCancel,
}: {
  count: number
  busy: boolean
  /** 主操作文案：「归档」/「取消归档」 */
  label: string
  /** 进行中文案 */
  busyLabel: string
  /** 次级的破坏性操作文案（如「删除」）。不传就不渲染这个按钮。 */
  dangerLabel?: string
  onAction: () => void
  onDanger?: () => void
  onCancel: () => void
}) {
  return (
    <div className="shrink-0 border-t border-neutral-100 bg-white px-5 py-3 dark:border-neutral-800 dark:bg-neutral-950">
      {/* 一条操作条最多三颗按钮，320px 宽时是紧的 ⇒ 统一 text-sm / px-3.5 */}
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
          已选 {count} 篇
        </span>
        <span className="flex-1" aria-hidden />
        <button
          onClick={onCancel}
          disabled={busy}
          className="shrink-0 rounded-xl px-3.5 py-2.5 text-sm text-neutral-500 active:opacity-60 disabled:opacity-40 dark:text-neutral-400"
        >
          取消
        </button>
        {dangerLabel && onDanger && (
          <button
            onClick={onDanger}
            disabled={count === 0 || busy}
            className="shrink-0 rounded-xl px-3.5 py-2.5 text-sm font-medium text-red-600 transition-colors active:opacity-60 disabled:opacity-40 dark:text-red-400"
          >
            {dangerLabel}
          </button>
        )}
        {/* 深色模式**不**做成「白底深字」的反转块：footnote-contrast 的 R2 禁止 dark:text-neutral-5xx
            及更深，而那条守卫按 token 判、看不到 dark:bg-white 这个上下文。与其为一块按钮放宽守卫，
            不如两端都用「实心底 + 白字」：浅色 neutral-800、深色 neutral-600，对比度都在 7:1 以上。 */}
        <button
          onClick={onAction}
          disabled={count === 0 || busy}
          className="shrink-0 rounded-xl bg-neutral-800 px-3.5 py-2.5 text-sm font-medium text-white transition-colors active:opacity-80 disabled:opacity-40 dark:bg-neutral-600 dark:text-white"
        >
          {busy ? busyLabel : label}
        </button>
      </div>
    </div>
  )
}
