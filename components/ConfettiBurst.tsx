'use client'

import { useMemo } from 'react'

const COLORS = ['#f97316', '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#06b6d4', '#ec4899']

// 保存成功的庆祝粒子（游戏获奖感）：从保存按钮位置向上爆发彩色纸屑
export default function ConfettiBurst() {
  const particles = useMemo(() =>
    Array.from({ length: 30 }, (_, i) => ({
      id: i,
      left: 50 + (Math.random() * 64 - 32), // 中心 ±32%
      delay: Math.random() * 0.12,
      duration: 0.8 + Math.random() * 0.6,
      color: COLORS[i % COLORS.length],
      dx: Math.random() * 140 - 70, // 水平飘散
      rot: Math.random() * 540 - 270,
      size: 6 + Math.random() * 6,
    })), [])

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-44 z-50 flex justify-center" aria-hidden>
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute rounded-sm"
          style={{
            width: p.size,
            height: p.size * 0.6,
            backgroundColor: p.color,
            left: `${p.left}%`,
            ['--dx' as string]: `${p.dx}px`,
            ['--rot' as string]: `${p.rot}deg`,
            animation: `confetti-fall ${p.duration}s ease-out ${p.delay}s forwards`,
          }}
        />
      ))}
    </div>
  )
}
