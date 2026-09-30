'use client'

import { TOOLBAR_ACTIONS, type ToolbarAction } from '@/lib/client/markdown'

// Markdown 工具条（写页 DiaryEditor 与详情页编辑态 EntryView 共用）。
//
// 为什么是「插入标记」而不是富文本：引一个富文本编辑器会带进几十万行第三方 JS，
// 与本项目「零第三方运行时脚本 + 严格 CSP」的立场冲突。正文里存 Markdown 源码。
//
// 为什么抽成组件：这条横条曾经只长在写页上——详情页编辑态漏了它（用户举报的 bug）。
// 两处共用一份后，按钮集合（lib/client/markdown.ts 的 TOOLBAR_ACTIONS）、样式与
// 「预览态隐藏按钮但保留这一行」的行为都不可能再各自漂移。
//
// ★ 位置：**编辑区顶部**（输入框/预览区之上），不是底部。
// 原因（2026-09-30 用户反馈）：手机输入时键盘从底部弹出，会把输入框下方的横条整个盖住，
// 工具条等于不可用。放到编辑区顶部后，键盘只影响下半屏，工具条始终露在键盘之上；
// 桌面端位置同理（仍是页头之下、正文之上），两处布局一致。
// 因此分隔线是 border-b（把工具条与它下方的正文分开），不再是 border-t。
//
// 预览态刻意不渲染动作按钮，但**保留这一行**（右侧「编辑 / 预览」按钮位置不动）：
// 否则切换时按钮会左右跳一下。

export default function MarkdownToolbar({ preview, disabled, onAction, onTogglePreview }: {
  preview: boolean
  disabled?: boolean
  onAction: (action: ToolbarAction) => void
  onTogglePreview: () => void
}) {
  return (
    <div className="mb-2 flex shrink-0 items-center gap-0.5 border-b border-neutral-100 pb-2 dark:border-neutral-800">
      {!preview && TOOLBAR_ACTIONS.map((a) => (
        <button
          key={a.key}
          type="button"
          onClick={() => onAction(a)}
          disabled={disabled}
          aria-label={a.title}
          className="rounded-lg px-2 py-1 text-sm text-neutral-500 active:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:active:bg-neutral-800"
        >
          {a.label}
        </button>
      ))}
      <span className="flex-1" />
      <button
        type="button"
        onClick={onTogglePreview}
        className="rounded-lg px-2 py-1 text-xs text-neutral-500 active:bg-neutral-100 dark:text-neutral-400 dark:active:bg-neutral-800"
      >
        {preview ? '编辑' : '预览'}
      </button>
    </div>
  )
}
