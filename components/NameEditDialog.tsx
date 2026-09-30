'use client'

import { useState } from 'react'
import { USER_NAME_MAX, saveUserName } from '@/lib/client/profile'

// 改名弹窗（设置页）。iOS Alert 风格，与 ConfirmDialog 保持一致。
// 名字由 DEK 加密后存服务器——本组件只负责收集与校验。
//
// 这里**不再提供「随机生成一个」**：默认名（Orbit_xxx）的生成只属于「库里还没有名字」
// 那一次，由 lib/client/profile.ts 的 loadUserName 懒创建完成（首次进入需要名字的页面时
// 自动生成并落库）。改名是用户主动表达偏好的动作，再给一个随机按钮既与「改名」语义不符，
// 也容易把已有名字一键覆盖掉。相关约定有 tests/name-edit-guard.test.ts 守着。
export default function NameEditDialog({ current, onSaved, onClose }: {
  current: string
  onSaved: (name: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = value.trim()
  const canSave = trimmed.length > 0 && trimmed !== current && !busy

  async function submit() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      await saveUserName(trimmed)
      onSaved(trimmed)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-8" onClick={onClose}>
      <div
        className="w-full max-w-xs overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="px-5 pb-4 pt-5">
          <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">修改名字</p>
          <p className="mt-2 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
            名字会加密后同步到你的其他设备，服务器看不到明文
          </p>
          <input
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null) }}
            maxLength={USER_NAME_MAX}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="mt-3 w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-base outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <div className="mt-1.5 text-right">
            <span className="text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400">{trimmed.length}/{USER_NAME_MAX}</span>
          </div>
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        </div>
        <div className="flex border-t border-neutral-200 dark:border-neutral-700">
          <button
            onClick={onClose}
            className="flex-1 border-r border-neutral-200 py-3.5 text-base text-neutral-700 active:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:active:bg-neutral-700"
          >
            取消
          </button>
          <button
            onClick={() => void submit()}
            disabled={!canSave}
            className="flex-1 py-3.5 text-base font-semibold text-blue-500 active:bg-neutral-100 disabled:opacity-40 dark:active:bg-neutral-700"
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
