'use client'

import { useEffect, useRef } from 'react'

export default function AutoTextarea({ value, onChange, placeholder, autoFocus, disabled }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
      className="w-full flex-1 resize-none bg-transparent text-lg leading-relaxed outline-none placeholder:text-neutral-300 disabled:opacity-60 dark:placeholder:text-neutral-600"
      style={{ minHeight: '50dvh' }}
    />
  )
}
