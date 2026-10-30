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
// 触屏设备判定：用「是否支持触控」这个更可靠的信号，而不是 `pointer: coarse`。
// ★ 为什么换掉（2026-10-30，用户反馈「PWA 首次点输入框键盘延迟」）：PWA(standalone) 里
//   `matchMedia('(pointer: coarse)')` 可能误报 fine ⇒ 走了桌面分支的裸 `focus()`，
//   在无用户手势时留下「已聚焦、无键盘」的假输入会话 ⇒ 首次点键盘要等系统先收掉它。
//   `navigator.maxTouchPoints > 0` 不依赖 pointer 特性，真机触屏恒真、桌面恒假。
function isCoarsePointer(): boolean {
  if (typeof window === 'undefined') return false
  return (navigator.maxTouchPoints ?? 0) > 0
}

export default function AutoTextarea({ value, onChange, placeholder, autoFocus, disabled, textareaRef }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
  textareaRef?: RefObject<HTMLTextAreaElement | null>
}) {
  const innerRef = useRef<HTMLTextAreaElement>(null)

  // ★ 挂载时的聚焦策略（2026-10-29 用户反馈「解锁后第一次点输入框，键盘延迟 0.5~1 秒；
  //   第二次立刻弹出」）：
  //
  //   原因：挂载**不在用户手势里**，iOS 会把 focus() 执行掉但**不弹键盘** ——
  //   textarea 进入「已聚焦、无键盘」的假输入会话。用户随后第一次点它，系统得先把这次
  //   假的会话收掉再重建，键盘因此晚 0.5~1 秒；第二次点时会话已经热了，立刻弹出。
  //   桌面端没有这层（键盘是硬件的，focus 即生效），所以不影响体验。
  //
  //   ★ 2026-10-30 补强（用户反馈「PWA 首次点键盘仍延迟」）：触屏上**彻底什么都不做** ——
  //   不 focus、不 setSelectionRange、不 scrollTo。后两个同样会触发 iOS 的输入会话准备
  //   （让系统以为要开始编辑），一样留下假会话。光标交给用户点哪落在哪，这也更贴合手机手感。
  //
  //   ⚠️ 刻意**不**把 autoFocus 传给 <textarea>：React 会在挂载时自己 focus() 一次，
  //   那等于绕过这里的判断，白改。聚焦只走这一个 effect。
  useEffect(() => {
    if (!autoFocus) return
    const el = textareaRef?.current ?? innerRef.current
    if (!el) return
    if (isCoarsePointer()) return // 触屏：什么都不做，等用户真点
    el.focus()
    try { el.setSelectionRange(el.value.length, el.value.length) } catch { /* 同上 */ }
  }, [autoFocus, textareaRef])

  return (
    <textarea
      ref={textareaRef ?? innerRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label="日记正文"
      disabled={disabled}
      className={`${EDITOR_TEXTAREA_CLASS} overflow-y-auto placeholder:text-neutral-500 dark:placeholder:text-neutral-400`}
    />
  )
}
