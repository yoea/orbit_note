'use client'

import { useEffect, useRef, type RefObject } from 'react'
import { EDITOR_TEXTAREA_CLASS } from '@/lib/client/ui'

// 输入区：高度由父级 flex 容器弹性分配（flex-1 + min-h-0），内容多时内部滚动。
// 键盘弹出时容器 h-dvh 自动收缩 → flex 自动压缩输入区，无需手动计算/监听。
//
// textareaRef：把真实 <textarea> 节点暴露给父组件。Markdown 工具条要读选区
// （selectionStart / selectionEnd）并在插入标记后还原选区——选区只存在于真实 DOM 节点上，
// 受控 value 替代不了。不传时退回内部 ref，行为与改造前逐字一致。
//
// 字号来自 EDITOR_TEXTAREA_CLASS（text-base，与查看页 qo-markdown 容器一致）：
// 此前这里单独写着 text-lg（18px），写页的字比查看页大一号 ⇒ 同一段文字在两边换行
// 位置不同，「所见即所得」断了。别在组件里另写字号，改常量（lib/client/ui.ts）。
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
      className={`${EDITOR_TEXTAREA_CLASS} overflow-y-auto placeholder:text-neutral-500 dark:placeholder:text-neutral-400`}
    />
  )
}
