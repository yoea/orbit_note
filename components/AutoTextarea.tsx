'use client'

import { useCallback, useEffect, useRef } from 'react'

// 可用高度：visualViewport（键盘弹出时变小）减去头部/底部操作区与安全区
function getAvailableHeight(): number {
  const vv = window.visualViewport
  const viewH = vv ? vv.height : window.innerHeight
  return Math.max(viewH - 190, 160)
}

export default function AutoTextarea({ value, onChange, placeholder, autoFocus, disabled }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // 统一高度逻辑：内容少时撑满当前可用区（进入时=全屏区，键盘弹出后=剩余区），
  // 内容多时按 scrollHeight 增长，最多不超过可用区（内部滚动）。
  const fitHeight = useCallback(() => {
    const el = ref.current
    if (!el) return
    const maxH = getAvailableHeight()
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`
    el.style.maxHeight = `${maxH}px`
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
      className="w-full flex-1 resize-none overflow-y-auto rounded-2xl bg-neutral-50 px-3 py-2 text-lg leading-relaxed outline-none placeholder:text-neutral-300 disabled:opacity-60 dark:bg-neutral-900/50 dark:placeholder:text-neutral-600"
    />
  )
}
