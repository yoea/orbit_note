'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'

// 键盘弹出时，为「正文编辑区」算出一个落在键盘上方的最大高度，并锁住文档。
//
// ── 目标（用户原话，2026-10-30）──────────────────────────────────────────
// 「打开键盘之后，整个页面不要滚动，只有输入区域的文字能滚动。」
//
// 必须同时做两件事（之前几版都只做了一半，故失败）：
//   1. **限高正文区**：键盘弹起时把正文区压到「可视高度 − 上方固定部分」，让 textarea 的
//      底边完全落在键盘上方 ⇒ iOS 的 scroll-into-view 找不到理由（光标已在可视区）⇒ 不平移整页。
//   2. **锁文档**：给 <html> 打 data-qo-keyboard ⇒ html 不可滚 + body fixed，文档高度归零
//      ⇒ iOS 想滚文档也没得滚。
//   · 只限高不锁（v2.5.5）⇒ body 满高可滚，iOS 仍平移 ⇒ 页面照样滑；
//   · 只锁不限高（v2.5.7~11）⇒ textarea 底边仍在键盘下 ⇒ iOS 仍 scroll-into-view。
//
// 用法：写页 DiaryEditor 与详情页编辑态 EntryView 各调用一次：
//   const { bodyRef, maxHeight } = useKeyboardEditorHeight()
//   把 bodyRef 挂到正文区容器、maxHeight 设为其 style.maxHeight。
export function useKeyboardEditorHeight(): {
  bodyRef: RefObject<HTMLDivElement | null>
  maxHeight: number | null
} {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [maxHeight, setMaxHeight] = useState<number | null>(null)
  // 正文区顶边到视口顶部的距离（= 上方固定部分 + 顶部安全区），键盘没弹时量一次
  const topOffsetRef = useRef<number | null>(null)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const root = document.documentElement
    const ATTR = 'data-qo-keyboard'
    const KEYBOARD_MIN_GAP = 120
    let raf = 0

    const locked = () => root.hasAttribute(ATTR)
    const lock = () => { if (!locked()) root.setAttribute(ATTR, '') }
    const unlock = () => { if (locked()) root.removeAttribute(ATTR) }

    const isEditable = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null
      if (!el || !el.tagName) return false
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true
    }

    const apply = () => {
      raf = 0
      if (vv.scale !== 1) { unlock(); setMaxHeight(null); return }
      const layoutHeight = root.clientHeight
      const gap = layoutHeight - vv.height
      if (gap > KEYBOARD_MIN_GAP) {
        lock()
        // 键盘没弹时量一次「正文区顶边到视口顶部」的距离 = 上方固定部分
        if (topOffsetRef.current == null && bodyRef.current) {
          topOffsetRef.current = Math.round(bodyRef.current.getBoundingClientRect().top)
        }
        if (topOffsetRef.current != null) {
          const h = vv.height - topOffsetRef.current
          setMaxHeight(Math.max(80, Math.round(h)))
        }
      } else {
        if (!isEditable(document.activeElement)) unlock()
        setMaxHeight(null)
        topOffsetRef.current = null // 键盘收起后，下次重新量（布局可能变了）
      }
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply) }

    const onFocusIn = (e: FocusEvent) => { if (isEditable(e.target)) lock() }
    const onTouchStart = (e: TouchEvent) => {
      const t = e.target as HTMLElement | null
      const editable = t && (t.closest('input, textarea') || t.closest('[contenteditable]')) as HTMLElement | null
      if (!editable) return
      lock()
      try { editable.focus({ preventScroll: true }) } catch { /* 忽略 */ }
    }

    apply()
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    window.addEventListener('orientationchange', schedule)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('touchstart', onTouchStart, true)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      window.removeEventListener('orientationchange', schedule)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('touchstart', onTouchStart, true)
      unlock()
      setMaxHeight(null)
    }
  }, [])

  return { bodyRef, maxHeight }
}
