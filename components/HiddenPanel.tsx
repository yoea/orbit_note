'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import WipeDataAction from './WipeDataAction'
import { DIALOG_FOOTER_BUTTON_CLASS } from '@/lib/client/ui'
import { useDialogBehavior } from '@/lib/client/dialog'

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
 * ★ 点「已归档」走 Link 直接导航，面板随页面一起卸载 —— 不需要先 onClose 再 push
 *   （那会多一帧"面板还在、页面已经换了"的错位）。
 *
 * ★ 视觉（2026-10-29 第二轮：用户说"太丑了"）：
 *   它是**关于弹窗的同门产品**，所以共用同一套语言 —— 顶部 3px 品牌渐变、
 *   一张 `max-w-xs` 的卡片、底部贴边整行的「完成」（`DIALOG_FOOTER_BUTTON_CLASS`，
 *   与 AboutDialog / PrefsDialog 逐字同源）。区别于「关于」的是更小的体量：
 *   一行图标 + 两行入口，不做长滚动。
 *   两行入口各有**一枚图标底**（紫=已归档、红=删除），因为纯文字两行看着像设置页的
 *   一段残片，加图标才有"这是一张独立的小面板"的边界感。
 */

/**
 * 打开后的「关闭闸门」时长（2026-10-29）。
 *
 * 事故：第 8 下点开面板的瞬间，关于弹窗被换掉、面板顶上来；手指还停在同一个位置，
 * 第 9 下点下去时落点已经是**面板的遮罩**（关于卡片比面板高，LOGO 在它的上半部；
 * 而面板卡片更矮、更靠中间 ⇒ 那一点正好落在卡片之外的遮罩上）⇒ 面板开了又关，
 * 看上去就是「第 9 下把它关掉了」。
 *
 * ⇒ 打开后 1 秒内**忽略遮罩点击**。★ 只拦遮罩：「完成」在卡片底部，不可能被连点
 *   误触，它要能立刻响应（那是明确的意图）。
 *
 * ★ `openedAt` 由**打开方**传进来，不在本组件里取 `Date.now()`：那是"不纯"的调用，
 *   渲染期调用会被 `react-hooks/purity` 判红（实测）；而打开动作本身就发生在事件处理
 *   函数里，时间天然是现成的。本组件只在打开时挂载一次 ⇒ `useRef(openedAt)` 拿到的
 *   就是这一次的打开时刻。
 */
const CLOSE_GUARD_MS = 1000

export default function HiddenPanel({ openedAt, onClose, wipeDisabled = false, onWipeBlocked }: {
  /** 打开时刻（Date.now()）：打开后 1 秒内的遮罩点击会被吞掉 */
  openedAt: number
  onClose: () => void
  /** 离线时「删除所有数据」不可用（与设置页其余写操作一致）；真正的破坏还要过通行密钥 */
  wipeDisabled?: boolean
  onWipeBlocked?: () => void
}) {
  // 删除流程（四步确认）在本面板之上再叠一层 fixed 层。
  // 条件渲染 ⇒ 每次挂载都是干净 state（见 WipeDataAction 的注释）。
  const [wipeOpen, setWipeOpen] = useState(false)
  // 打开时刻存进 ref（不参与渲染）。本组件只在打开时挂载 ⇒ 初值就是本次打开时刻。
  const openedAtRef = useRef(openedAt)
  // Esc = requestClose（带 1 秒闸门，与点遮罩同义，不走裸 onClose 绕过闸门）；
  // Tab 循环 / 焦点归还统一在 useDialogBehavior。
  const cardRef = useRef<HTMLDivElement>(null)
  useDialogBehavior(cardRef, requestClose)

  // 遮罩专用：打开后 1 秒内直接吞掉（理由见 CLOSE_GUARD_MS 的注释）。
  // 卡片内有 stopPropagation，所以这里接到的只可能是「点在面板外面」的意图。
  function requestClose() {
    if (Date.now() - openedAtRef.current < CLOSE_GUARD_MS) return
    onClose()
  }

  return (
    <>
      {/* ★ 删除流程打开时**整块不渲染**（2026-10-29 用户反馈"两个框重叠了"）：
          面板与 WipeDataAction 都是 `fixed inset-0 z-50`，同一层级叠在一起，
          下面的白卡会从 40% 遮罩里透出来。互斥渲染比调 z-index 干净——
          层级只是把问题藏起来（多一层遮罩叠成更暗），渲染互斥则根本不会有第二个框。 */}
      {!wipeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-8" onClick={requestClose}>
          <div
            ref={cardRef}
            className="w-full max-w-xs overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-800"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="隐藏入口"
          >
            {/* 品牌渐变态：与关于弹窗、TabBar 选中态、主按钮同一条 */}
            <div className="h-[3px] w-full bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500" />

            <div className="px-5 pb-4 pt-5 text-center">
              {/* 锁形徽标：这一屏的"身份"——藏起来的东西。渐变底用品牌两端的浅色，
                  不做实心填充（那是主按钮的语言，这里只是标点级别的装饰）。 */}
              <span
                aria-hidden
                className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-violet-100 to-rose-100 text-violet-600 dark:from-violet-500/20 dark:to-rose-500/15 dark:text-violet-300"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
              <p className="mt-2.5 text-base font-semibold text-neutral-900 dark:text-neutral-100">隐藏入口</p>
              <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                连点「关于」里的 LOGO 8 次才会出现
              </p>
            </div>

            <ul className="border-t border-neutral-100 dark:border-neutral-700">
              <li>
                <Link href="/settings/archive" className="flex items-center gap-3 px-4 py-3 active:bg-neutral-100 dark:active:bg-neutral-700">
                  <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <rect x="2" y="3" width="20" height="5" rx="1" />
                      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
                      <path d="M10 12h4" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-sm text-neutral-800 dark:text-neutral-200">已归档</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                      收起来的日记都在这里
                    </span>
                  </span>
                  <span aria-hidden className="shrink-0 text-neutral-500 dark:text-neutral-400">›</span>
                </Link>
              </li>
              <li className="border-t border-neutral-100 dark:border-neutral-700">
                <button
                  onClick={() => {
                    if (wipeDisabled) { onWipeBlocked?.(); return }
                    setWipeOpen(true)
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-neutral-100 dark:active:bg-neutral-700"
                >
                  <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <path d="M3 6h18" />
                      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                      <path d="M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm text-red-600 dark:text-red-400 ${wipeDisabled ? 'opacity-50' : ''}`}>
                      删除所有数据
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                      不可撤销，需要通行密钥验证
                    </span>
                  </span>
                  <span aria-hidden className="shrink-0 text-neutral-500 dark:text-neutral-400">›</span>
                </button>
              </li>
            </ul>

            <button onClick={onClose} className={DIALOG_FOOTER_BUTTON_CLASS}>
              完成
            </button>
          </div>
        </div>
      )}

      {/* 删除流程自带 `fixed inset-0 z-50` 与遮罩，单独成层（不叠在面板的遮罩里） */}
      {wipeOpen && (
        <WipeDataAction onClose={() => setWipeOpen(false)} disabled={wipeDisabled} onBlocked={onWipeBlocked} />
      )}
    </>
  )
}
