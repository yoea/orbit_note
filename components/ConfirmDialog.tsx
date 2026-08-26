'use client'

// iOS 原生 Alert 风格确认弹窗：
// 新版 iOS Safari 的 window.confirm 是纯文字按钮（不明显），自绘圆角卡片 + 双按钮还原原生观感。
// 支持破坏性操作（确认按钮红色加粗，如删除）。
export default function ConfirmDialog({ title, message, confirmText = '好', cancelText = '取消', destructive, onConfirm, onCancel }: {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-8" onClick={onCancel}>
      <div
        className="w-full max-w-xs overflow-hidden rounded-2xl bg-white text-center shadow-xl dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
      >
        <div className="px-5 pb-4 pt-5">
          <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</p>
          {message && <p className="mt-2 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">{message}</p>}
        </div>
        <div className="flex border-t border-neutral-200 dark:border-neutral-700">
          <button
            onClick={onCancel}
            className="flex-1 border-r border-neutral-200 py-3.5 text-base text-neutral-700 active:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:active:bg-neutral-700"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-3.5 text-base font-semibold active:bg-neutral-100 dark:active:bg-neutral-700 ${destructive ? 'text-red-500' : 'text-blue-500'}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
