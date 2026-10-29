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
//
// 一条操作条上最多三颗按钮 + 一行统计，320px 宽时是紧的 ⇒ 统一 text-sm / px-3.5。
// 「退出选择态」不放这里：两个页面在**页头**都有「完成」，重复一个只会挤宽度。
export default function BulkActionBar({
  count, total, busy, label, busyLabel, dangerLabel, onToggleAll, onAction, onDanger,
}: {
  count: number
  /** 当前**已加载**的条目数 —— 全选的范围就是它（不是服务器上的全部，见下面注释） */
  total: number
  busy: boolean
  /** 主操作文案：「归档」/「取消归档」 */
  label: string
  /** 进行中文案 */
  busyLabel: string
  /** 次级的破坏性操作文案（如「彻底删除」）。不传就不渲染这个按钮。 */
  dangerLabel?: string
  onToggleAll: () => void
  onAction: () => void
  onDanger?: () => void
}) {
  const allSelected = total > 0 && count === total
  return (
    <div className="shrink-0 border-t border-neutral-100 bg-white px-5 py-3 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center gap-2">
        {/* 全选的口径 = **已加载的**（分页没到底时不含更早的）。
            title 里写明数量，避免用户以为"全选 = 服务器上的全部"。 */}
        <button
          onClick={onToggleAll}
          disabled={busy || total === 0}
          title={allSelected ? '取消全选' : `全选已加载的 ${total} 篇`}
          aria-label={allSelected ? '取消全选' : `全选已加载的 ${total} 篇`}
          className="shrink-0 rounded-xl px-2.5 py-2.5 text-xs font-medium text-neutral-600 active:opacity-60 disabled:opacity-40 dark:text-neutral-300"
        >
          {allSelected ? '取消全选' : '全选'}
        </button>
        <span className="min-w-0 truncate text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
          已选 {count} 篇
        </span>
        <span className="flex-1" aria-hidden />
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
