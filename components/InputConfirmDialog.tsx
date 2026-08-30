'use client'

import { useState } from 'react'

// 输入验证弹窗（iOS Alert 风格）：必须输入指定文字才能确认——防误触的强确认手段
// （类似 GitHub 删除仓库需输入仓库名）。输入不匹配时确认按钮不可点。
// destructive：红色边框 + 删除主题（配合 message 中的加粗红重点文字）。
export default function InputConfirmDialog({ title, message, expected, placeholder, confirmText = '删除', cancelText = '取消', destructive, onConfirm, onCancel }: {
  title: string
  message?: React.ReactNode
  expected: string // 必须完全匹配的文字
  placeholder?: string
  confirmText?: string
  cancelText?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const matched = value.trim() === expected

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-8" onClick={onCancel}>
      <div
        className={`w-full max-w-xs overflow-hidden rounded-2xl bg-white text-center shadow-xl dark:bg-neutral-800 ${destructive ? 'border border-red-300 dark:border-red-800' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
      >
        <div className="px-5 pb-4 pt-5">
          <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</p>
          {message && <div className="mt-2 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">{message}</div>}
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            autoComplete="off" data-lpignore="true" // 阻止浏览器/密码管理器自动填充
            autoFocus
            className="mt-4 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-base outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
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
            disabled={!matched}
            className={`flex-1 py-3.5 text-base font-semibold disabled:opacity-40 ${matched ? 'text-red-500' : 'text-neutral-300 dark:text-neutral-500'}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
