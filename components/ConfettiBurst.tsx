'use client'

import { useEffect, useState } from 'react'

const COLORS = ['#f97316', '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#06b6d4', '#ec4899']

interface Particle {
  id: number
  left: number
  delay: number
  duration: number
  color: string
  dx: number
  rot: number
  size: number
}

// 保存成功的庆祝粒子（游戏获奖感）：从保存按钮位置向上爆发彩色纸屑。
// 粒子在 effect 中生成（避免 render 期间调用不纯函数 Math.random）。
//
// 定位：**锚定在父级 footer 的顶边**（absolute inset-x-0 top-0），而不是 fixed + 像素偏移。
// 历史问题：原实现用 `fixed bottom-44`（写死 176px），这个数字其实等于
//   TabBar 高（max(env(safe-area-inset-bottom),1rem) + 53px 内容）
// + DiaryEditor footer 高（pt-2 + 状态行 + mb-3 + 按钮 py-4 + pb-4 ≈ 112px）
// ——一旦 TabBar 的内边距、字号或 footer 间距改动，爆发原点就会漂移，且没有任何提示。
// 改成绝对定位后原点由布局自动推导，两个组件各自改内边距都不必再同步这个数字。
// 调用方需保证父级 footer 是 relative（见 DiaryEditor.tsx）。
export default function ConfettiBurst() {
  const [particles, setParticles] = useState<Particle[]>([])

  useEffect(() => {
    const t = setTimeout(() => {
      setParticles(Array.from({ length: 30 }, (_, i) => ({
        id: i,
        left: 50 + (Math.random() * 64 - 32), // 中心 ±32%
        delay: Math.random() * 0.12,
        duration: 0.8 + Math.random() * 0.6,
        color: COLORS[i % COLORS.length],
        dx: Math.random() * 140 - 70, // 水平飘散
        rot: Math.random() * 540 - 270,
        size: 6 + Math.random() * 6,
      })))
    }, 0)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-50 flex justify-center" aria-hidden>
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
