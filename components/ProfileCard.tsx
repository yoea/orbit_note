'use client'

import { useEffect, useState } from 'react'
import { useProfile } from '@/lib/client/use-user-name'

interface Stats {
  count: number
  days: number
  words: number
  firstDay: string | null
}

// 日期只展示到「年月日」。
// 需要区分两种输入：ISO 时间戳（注册时间，含 T，必须做本地时区换算，
// 否则 UTC 日期可能比本地日期早一天）与纯日期串（yyyy-mm-dd，第一篇日记所在日）。
function formatYmd(value: string): string {
  if (value.includes('T')) {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (m) return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`
  return value
}

// 个人信息卡片：生成式头像（名字首字符 + 品牌渐变）+ 名字 + 一行小字。
// 小字 = 始于 <日期> · N 篇 · N 天 · N 字；点击进入改名。
export default function ProfileCard({ onEditName }: { onEditName: () => void }) {
  const { name, createdAt } = useProfile()
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/diary/stats')
        if (!res.ok) return
        const data = await res.json() as {
          count: number
          days: number
          byDay: Record<string, { count: number; words: number }>
        }
        const byDay = data.byDay ?? {}
        setStats({
          count: data.count,
          days: data.days,
          words: Object.values(byDay).reduce((sum, d) => sum + d.words, 0),
          firstDay: Object.keys(byDay).sort()[0] ?? null,
        })
      } catch {
        /* 拉取失败：小字整行不显示——绝不能显示 0，那会让人以为日记没了 */
      }
    })()
  }, [])

  // 注册时间优先用服务端记录的；老用户（该字段为空）回退为第一篇日记的日期
  const startedAt = createdAt ?? stats?.firstDay ?? null
  const parts: string[] = []
  if (startedAt) parts.push(`始于 ${formatYmd(startedAt)}`)
  if (stats) {
    parts.push(`${stats.count} 篇`)
    parts.push(`${stats.days} 天`)
    parts.push(`${stats.words.toLocaleString()} 字`)
  }
  const subtitle = parts.join(' · ')
  // 生成式头像：名字首字符（[...name] 展开，避免 emoji / 代理对被截成半个字符）
  const initial = name ? ([...name][0] ?? '·') : '·'

  return (
    <button
      onClick={onEditName}
      className="mt-2 flex w-full items-center gap-3 rounded-2xl bg-neutral-50/60 px-4 py-3.5 text-left active:opacity-60 dark:bg-neutral-900/40"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 via-rose-400 to-violet-500 text-lg font-semibold text-white">
        {initial}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium text-neutral-800 dark:text-neutral-100">
          {name ?? '加载中…'}
        </span>
        {subtitle && <span className="mt-0.5 block truncate text-xs tabular-nums text-neutral-400">{subtitle}</span>}
      </span>
      <span className="shrink-0 text-lg text-neutral-300">›</span>
    </button>
  )
}
