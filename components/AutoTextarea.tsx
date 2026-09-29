'use client'

import { useEffect, useRef } from 'react'

// 输入区：高度由父级 flex 容器弹性分配（flex-1 + min-h-0），内容多时内部滚动。
// 键盘弹出时容器 h-dvh 自动收缩 → flex 自动压缩输入区，无需手动计算/监听。
export default function AutoTextarea({ value, onChange, placeholder, autoFocus, disabled }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
      className="w-full min-h-0 flex-1 resize-none overflow-y-auto bg-transparent text-lg leading-relaxed outline-none placeholder:text-neutral-500 disabled:opacity-60 dark:placeholder:text-neutral-400"
    />
  )
}
