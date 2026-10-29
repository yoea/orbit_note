'use client'

import { useState } from 'react'
import Link from 'next/link'
import WipeDataAction from './WipeDataAction'

/**
 * 隐藏入口面板（2026-10-29 用户要求）。
 *
 * 由 AboutDialog 的「连点 LOGO 8 次」打开。它收两件**不该在日常设置里露脸**的事：
 *   · 已归档  —— 原来在「设置 → 数据」组里，用户明确要求收进这里（入口可以再深一点）；
 *   · 删除所有数据 —— 一直是彩蛋入口，四步确认在 WipeDataAction 里。
 *
 * ★ 为什么两者放一起而不是各给一个入口：它们都是"低频到几乎不用"的东西，
 *   一个彩蛋出口指两扇门，比让它们在设置页各占一行更符合"降级可发现性"的初衷。
 * ★ 「删除所有数据」仍然是红字 + 四步确认：入口隐蔽 ≠ 危险度降低。
 * ★ 点「已归档」走 Link 直接导航，面板随设置页一起卸载 —— 不需要先 onClose 再 push
 *   （那会多一帧"面板还在、页面已经换了"的错位）。
 */
export default function HiddenPanel({ onClose, wipeDisabled = false, onWipeBlocked }: {
  onClose: () => void
  /** 离线时「删除所有数据」不可用（与设置页其余写操作一致）；真正的破坏还要过通行密钥 */
  wipeDisabled?: boolean
  onWipeBlocked?: () => void
}) {
  // 删除流程（四步确认）在本面板之上再叠一层 fixed 层。
  // 条件渲染 ⇒ 每次挂载都是干净 state（见 WipeDataAction 的注释）。
  const [wipeOpen, setWipeOpen] = useState(false)

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-8" onClick={onClose}>
        <div
          className="w-full max-w-xs overflow-hidden rounded-2xl bg-white dark:bg-neutral-800"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="隐藏入口"
        >
          <div className="px-5 pb-3 pt-5 text-center">
            <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">隐藏入口</p>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              连点「关于」里的 LOGO 8 次才会出现
            </p>
          </div>
          <ul className="flex flex-col divide-y divide-neutral-100 border-y border-neutral-100 dark:divide-neutral-700 dark:border-neutral-700">
            <li>
              <Link href="/settings/archive" className="flex items-center justify-between gap-3 px-5 py-3.5 active:opacity-60">
                <span className="text-sm text-neutral-800 dark:text-neutral-200">已归档</span>
                <span className="shrink-0 text-neutral-500 dark:text-neutral-400">›</span>
              </Link>
            </li>
            <li>
              <button
                onClick={() => {
                  if (wipeDisabled) { onWipeBlocked?.(); return }
                  setWipeOpen(true)
                }}
                className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left active:opacity-60"
              >
                <span className={`text-sm text-red-600 dark:text-red-400 ${wipeDisabled ? 'opacity-50' : ''}`}>
                  删除所有数据
                </span>
                <span className="shrink-0 text-neutral-500 dark:text-neutral-400">›</span>
              </button>
            </li>
          </ul>
          <button
            onClick={onClose}
            className="w-full py-3.5 text-base text-neutral-700 active:bg-neutral-100 dark:text-neutral-300 dark:active:bg-neutral-700"
          >
            关闭
          </button>
        </div>
      </div>
      {wipeOpen && (
        <WipeDataAction onClose={() => setWipeOpen(false)} disabled={wipeDisabled} onBlocked={onWipeBlocked} />
      )}
    </>
  )
}
