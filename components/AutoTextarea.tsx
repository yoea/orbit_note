'use client'

import { useCallback, useEffect, useRef } from 'react'

// 可用高度：visualViewport（键盘弹出时变小）减去头部/底部操作区与安全区。
// 输入框固定占满此区域（内容多时内部滚动），键盘弹出时自动收缩到剩余区。
function getAvailableHeight(): number {
  const vv = window.visualViewport
  const viewH = vv ? vv.height : window.innerHeight
  return Math.max(viewH - 200, 160)
}

export default function AutoTextarea({ value, onChange, placeholder, autoFocus, disabled }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // 高度逻辑：固定占满当前可用区（header 与底部操作栏之间），内容多时内部滚动；
  // 键盘弹出时 visualViewport 变小 → 自动收缩到剩余区（统一不割裂）。
  const fitHeight = useCallback(() => {
    const el = ref.current
    if (!el) return
    const h = getAvailableHeight()
    el.style.height = `${h}px`
    el.style.maxHeight = `${h}px`
  }, [])

  // 内容变化 → 重新适配
  useEffect(() => {
    fitHeight()
  }, [value, fitHeight])

  // 键盘弹出/收起（visualViewport resize）→ 重新适配
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    vv.addEventListener('resize', fitHeight)
    return () => vv.removeEventListener('resize', fitHeight)
  }, [fitHeight])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
      className="mt-3 w-full resize-none overflow-y-auto bg-transparent text-lg leading-relaxed outline-none placeholder:text-neutral-300 disabled:opacity-60 dark:placeholder:text-neutral-600"
    />
  )
}
