'use client'

import { useEffect, useState } from 'react'

// 键盘弹出时「实际可见」的高度（px）；键盘没弹出时返回 null。
//
// ── 为什么需要（iOS 键盘不改 dvh）──────────────────────────────────────
// iOS 的键盘**不改变布局视口、不改变 dvh**，只让 visualViewport 变小。
// 于是 body 的 100dvh（满屏）在键盘弹起后仍满高，比「键盘上方的可视区」高出一整个键盘。
// 这段差值就是页面「整体可滚动 / 被推上去」的来源。
//
// 用法：写页/编辑页把返回值当作**内容列**的高度上限（`maxHeight` 或 `height`）。
// 内容列缩到可视区之内 ⇒ 光标始终在可视区 ⇒ iOS 没有理由滚 ⇒ 页头/工具条/保存按钮原地不动，
// 只有 textarea 内部的文字滚动。footer 配 `mt-auto` 贴回列底（键盘上沿）。
//
// 保守设计：
//   1. 缩放（scale !== 1）时不生效（那是缩放不是键盘）；
//   2. 只认「键盘量级」的高度差（>120px），URL 栏收缩等小差值不触发；
//   3. 无 visualViewport 直接返回 null。
export function useVisibleViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const KEYBOARD_MIN_GAP = 120
    let raf = 0

    const apply = () => {
      raf = 0
      if (vv.scale !== 1) { setHeight(null); return }
      const layoutHeight = document.documentElement.clientHeight
      const gap = layoutHeight - vv.height
      setHeight(gap > KEYBOARD_MIN_GAP ? Math.round(vv.height) : null)
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply) }

    apply()
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    window.addEventListener('orientationchange', schedule)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      window.removeEventListener('orientationchange', schedule)
    }
  }, [])

  return height
}
