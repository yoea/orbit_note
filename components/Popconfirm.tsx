'use client'

import { useRef } from 'react'
import { useDialogBehavior } from '@/lib/client/dialog'

/**
 * 气泡确认框（2026-10-29 用户要求）。
 *
 * 替代详情页底部那些「点一下图标 → 弹一整块模态确认」的用法：
 *   · 归档 / 取消归档
 *   · 删除
 *
 * ★ 为什么用气泡而不是模态：模态确认把整页变暗、把用户从"这一篇"里拽出来，
 *   而这两个动作的对象明确到不需要再指认（就是脚下这一篇）。气泡贴着按钮长出来，
 *   上下文不丢；代价是文案必须压到一两句（放不下长解释），这正是我们要的克制。
 *
 * ★ 为什么**不**做成通用弹出层（portal / 计算屏幕坐标）：
 *   它由调用方套在一个 `position: relative` 的容器里，靠 `absolute bottom-full`
 *   贴在按钮上方。理由是这个操作栏就在屏幕底部，**上方永远有空间**，
 *   而 portal + 测量坐标要处理滚动、视口变化、iOS 键盘，成本和风险都不值。
 *   ⚠️ 调用方容器必须自己写 `relative`，否则气泡会跑到最近的定位祖先上去。
 *
 * ★ 遮挡层（`fixed inset-0 z-40`）只负责"点外面关掉"，视觉上完全透明：
 *   气泡本体 z-50 在它之上。两层都不带任何 transform / filter，
 *   符合「全站零 backdrop-filter / 祖先不得有 transform」的约定。
 */
export default function Popconfirm({ open, message, confirmText, cancelText = '取消', destructive = false, onConfirm, onCancel }: {
  open: boolean
  /** 一两句话：做什么、能不能撤销、去哪找回。写长了气泡会很高，反而看不清 */
  message: string
  confirmText: string
  cancelText?: string
  /** true = 确认键用红色（不可撤销的动作） */
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  // Esc 关闭 / Tab 循环 / 焦点归还：useDialogBehavior 统一管（2026-10-29 前是本组件
  // 自己挂的 window keydown，叠层时会一次关掉多层；迁移后走全局 Esc 栈，只关最上层）。
  // ★ 本组件常驻挂载、用 open prop 控制 ⇒ 传 { active: open }。
  const bubbleRef = useRef<HTMLDivElement>(null)
  useDialogBehavior(bubbleRef, onCancel, { active: open })

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onCancel} aria-hidden />
      <div
        ref={bubbleRef}
        role="dialog"
        aria-label={message}
        aria-modal="true"
        /* 右对齐到按钮：操作栏在屏幕右侧，左对齐会在窄屏上顶出去。
           `w-56`(224px) 是 320px 卡片里还能剩 20px 边距的上限。 */
        className="absolute bottom-full right-0 z-50 mb-1 w-56 rounded-xl border border-neutral-200 bg-white p-3 text-left shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
      >
        <p className="text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">{message}</p>
        <div className="mt-2.5 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-neutral-200 py-1.5 text-xs font-medium text-neutral-600 active:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:active:bg-neutral-700"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium text-white active:opacity-80 ${destructive ? 'bg-red-500' : 'bg-neutral-800 dark:bg-neutral-600'}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </>
  )
}
