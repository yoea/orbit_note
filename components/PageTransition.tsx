'use client'

import { ViewTransition } from 'react'

// 页面切换动画包装：前进（nav-forward）旧页左滑出/新页右滑入，返回（nav-back）反向。
// 配合 <Link transitionTypes> 或 router.push(url, { transitionTypes }) 触发方向性动画；
// 无类型导航（浏览器返回、刷新）→ default 'none' 无动画（原生行为）。
// 浏览器不支持 View Transitions API 时直接正常导航，无副作用（渐进增强）。
export default function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition
      enter={{ 'nav-forward': 'nav-forward', 'nav-back': 'nav-back', default: 'none' }}
      exit={{ 'nav-forward': 'nav-forward', 'nav-back': 'nav-back', default: 'none' }}
      default="none"
    >
      {children}
    </ViewTransition>
  )
}
