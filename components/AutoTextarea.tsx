'use client'

import { useEffect, useRef, type RefObject } from 'react'

// 输入区：高度由父级 flex 容器弹性分配（flex-1 + min-h-0），内容多时内部滚动。
// 键盘弹出时容器 h-dvh 自动收缩 → flex 自动压缩输入区，无需手动计算/监听。
//
// textareaRef：把真实 <textarea> 节点暴露给父组件。Markdown 工具条要读选区
// （selectionStart / selectionEnd）并在插入标记后还原选区——选区只存在于真实 DOM 节点上，
// 受控 value 替代不了。不传时退回内部 ref，行为与改造前逐字一致。
export default function AutoTextarea({ value, onChange, placeholder, autoFocus, disabled, textareaRef }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
  textareaRef?: RefObject<HTMLTextAreaElement | null>
}) {
  const innerRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) (textareaRef?.current ?? innerRef.current)?.focus()
  }, [autoFocus, textareaRef])

  return (
    <textarea
      ref={textareaRef ?? innerRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
      className="w-full min-h-0 flex-1 resize-none overflow-y-auto bg-transparent text-lg leading-relaxed outline-none placeholder:text-neutral-500 disabled:opacity-60 dark:placeholder:text-neutral-400"
    />
  )
}
