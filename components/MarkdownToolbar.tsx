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
// 预览态刻意不渲染动作按钮，但**保留这一行**（右侧「编辑 / 预览」按钮位置不动）：
// 否则切换时按钮会左右跳一下。

export default function MarkdownToolbar({ preview, disabled, onAction, onTogglePreview }: {
  preview: boolean
  disabled?: boolean
  onAction: (action: ToolbarAction) => void
  onTogglePreview: () => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-t border-neutral-100 pt-2 dark:border-neutral-800">
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
