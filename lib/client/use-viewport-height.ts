'use client'

import { useEffect, useState } from 'react'

// 键盘弹出时「实际可见」的高度（px）；键盘没弹出时返回 null。
//
// ── 为什么需要这个 hook（2026-10-06 用户反馈「输入长文本时 Markdown 工具条会隐藏」）──
//
// 根因：编辑页的高度来自 `100dvh`（.app-height），而 **iOS 的键盘不改变 dvh**。
//   键盘弹起时布局视口仍是满屏（844），但可见区只剩约 500 ⇒ 输入框的下沿落在键盘底下。
//   iOS 为了让光标可见，会**把可视视口（visual viewport）整体向上滚**。
//   于是排版在「布局视口顶部」的那一条 —— 页头与 Markdown 工具条 —— 被顶出屏幕；
//   写得越长、光标越往下，iOS 滚得越多，工具条就「一直看不到」。
//   同一根因还让底部的「保存」按钮被键盘遮住。
//
// ★ 这不是新问题：早期 AutoTextarea 里就有基于 visualViewport 的 fitHeight 实现，
//   2026-08-26（f5090e4）为了「固定视口高度 + flex 弹性分配」把它删了，理由写的是
//   「键盘弹出时 dvh 收缩自动压缩」——**这句话在 iOS 上不成立**（dvh 不理键盘）。
//   本次把这条能力补回来，但只补「高度」这一件事，不再回到手工算像素的老路。
//
// 用法：把返回值当作编辑区容器的高度（`flex: 0 0 Npx`）。容器矮到可见区之内，
//   光标就在可见区内 ⇒ iOS 没有任何理由再去滚可视视口 ⇒ 页头与工具条原地不动。
//
// 三个刻意的保守设计（宁可不生效，也不要算错把界面搞乱）：
//   1. **双指缩放时不生效**：`visualViewport.height` 在缩放下也会变小，但那是缩放不是键盘；
//      判据是 `scale !== 1` 直接跳过（此时退回 flex 布局，与改造前一致）。
//   2. **只认「键盘量级」的高度差**：`布局视口高度 − 可见高度 ≤ 120px` 时一律返回 null。
//      URL 栏收缩、分屏、软键盘没弹出等都会产生几十像素的小差值，不该触发。
//   3. **不支持 visualViewport 的环境直接返回 null**（老浏览器），行为与改造前一模一样。
//
// 局限（说清楚）：这只能让「页面自己被键盘挤下去」不再发生。
// 如果某个平台连 visualViewport 都不随键盘变化，那它本来就没有这个问题，也就无需修。
export function useVisibleViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    // 键盘量级的最小差值：小于它一律认为「不是键盘」
    const KEYBOARD_MIN_GAP = 120
    let raf = 0

    const apply = () => {
      raf = 0
      if (vv.scale !== 1) return // 缩放过的不算
      const layoutHeight = document.documentElement.clientHeight
      const gap = layoutHeight - vv.height
      setHeight(gap > KEYBOARD_MIN_GAP ? Math.round(vv.height) : null)
    }
    // 合并同一帧内的多次触发（键盘动画期间 resize 会连发很多次）
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply)
    }

    apply()
    vv.addEventListener('resize', schedule)
    // 也监听 scroll：可视视口被滚走时高度不变但位置变了，重新算一次能回到正确高度
    vv.addEventListener('scroll', schedule)
    // 方向变化会改布局视口高度，而 vv 的 resize 不一定会跟着来
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
