'use client'

import { useId } from 'react'

// 「Q 版五角星」——收藏（星标）的图标。
//
// 造型：把标准五角星的内半径调大（r/R ≈ 0.52，接近正十边形的胖星），再用**与填充同色的
// 粗描边 + strokeLinejoin="round"** 把五个尖角磨圆——这是不引第三方图标库就能做出
// 「圆润可爱」观感的做法（只靠 fill 的话尖角会很锐，像评分控件而不像收藏标记）。
//
// 颜色：暖色渐变（amber → orange），**刻意不入 TabBar 那套描边渐变**（qo-tab-accent 是
// 描边图标用的，violet 端偏冷；收藏要的是暖色实心）。
//
// ★ 只挂在「查看页」与「笔记列表页」两处（tests/entry-star.test.ts 守着）：
//   收藏是**这一篇的状态**，其他页面（搜索、设置、导出导入）不显示它，
//   免得同一个状态在多处出现、让人以为它们各自独立。
export default function StarIcon({ filled, className = 'h-4 w-4' }: { filled: boolean; className?: string }) {
  // 每个实例一份渐变 id（同一个页面上会渲染很多颗星；重复 id 会让浏览器只认第一个，
  // 一旦那一颗被卸载，其它星的填充就会失效）。useId 带冒号，SVG 的 url(#…) 里得剥掉。
  const gradientId = `qo-star-${useId().replace(/:/g, '')}`
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false" className={className}>
      {filled && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="55%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M12 3.6 L14.59 8.44 L20 9.4 L16.18 13.36 L16.94 18.8 L12 16.4 L7.06 18.8 L7.82 13.36 L4.01 9.4 L9.41 8.44 Z"
        fill={filled ? `url(#${gradientId})` : 'none'}
        stroke={filled ? `url(#${gradientId})` : 'currentColor'}
        strokeWidth={filled ? 3 : 1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
