'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'

// 键盘弹起时，给「正文编辑区」算一个高度上限，让光标始终露在键盘上方。
//
// ── 用户目标（原话，2026-10-30）──────────────────────────────────────────
// 「只希望 textarea 能动，让光标时刻保持在键盘之上，其他不动，底部 navbar 永远贴在屏幕底部。」
//
// 做法：只给正文区一个 `maxHeight`（= 可视高度 − 正文区顶边到屏幕顶的距离 − 余量）。
//   · 正文区变矮 ⇒ 光标始终在键盘上方 ⇒ iOS 没有理由去平移整页；
//   · footer 用 `mt-auto` 贴回列底、shrink-0 ⇒ 位置不变（仍在屏幕底部，被键盘盖住）；
//   · TabBar 在 body 的 flex 列底部，body 高度不变 ⇒ 永远贴在屏幕底部；
//   · 文档层另有一道兜底（html/body 不可滚，见 globals.css）。
// 一句话：**只改 textarea 的高度，其他元素一个都不动。**
//
// 关键坑：正文区的顶边距离必须在**键盘没弹起时**量。键盘弹起后页面可能被平移，
// 那时量出来的 top 已经不具有参考意义（v2.5.12 就在这上面翻过车）。
//
// 保守设计：缩放（scale !== 1）不生效；只认「键盘量级」的高度差（>120px）；无
// visualViewport 直接返回 null。
export function useKeyboardEditorHeight(): {
  bodyRef: RefObject<HTMLDivElement | null>
  maxHeight: number | null
} {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [maxHeight, setMaxHeight] = useState<number | null>(null)
  // 正文区顶边到屏幕顶的距离 —— **只在键盘没弹起时**更新（见上面的注释）
  const topOffsetRef = useRef<number | null>(null)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const KEYBOARD_MIN_GAP = 120
    // 正文区底部与键盘之间留一点余量，光标贴边时不至于被键盘压住
    const BOTTOM_GAP = 8
    let raf = 0

    const apply = () => {
      raf = 0
      if (vv.scale !== 1) { setMaxHeight(null); return } // 缩放不是键盘
      const gap = document.documentElement.clientHeight - vv.height
      if (gap > KEYBOARD_MIN_GAP) {
        // 键盘弹起：用「未弹起时」量到的顶边距离算上限
        if (topOffsetRef.current != null) {
          const h = vv.height - topOffsetRef.current - BOTTOM_GAP
          setMaxHeight(Math.max(80, Math.round(h)))
        }
      } else {
        // 键盘未弹：此时量到的顶边距离才是准的
        if (bodyRef.current) topOffsetRef.current = bodyRef.current.getBoundingClientRect().top
        setMaxHeight(null)
      }
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply) }

    apply()
    vv.addEventListener('resize', schedule)
    // offsetTop 变化走 scroll（键盘动画期间两件事都会发生）
    vv.addEventListener('scroll', schedule)
    window.addEventListener('orientationchange', schedule)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      window.removeEventListener('orientationchange', schedule)
      setMaxHeight(null)
    }
  }, [])

  return { bodyRef, maxHeight }
}
