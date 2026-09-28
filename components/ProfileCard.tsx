'use client'

import { useDiaryOverview } from '@/lib/client/diary-overview'
import { useProfile } from '@/lib/client/use-user-name'

// 个人信息卡片：生成式头像（名字首字符 + 品牌渐变）+ 名字 + 一行统计。
// 点击进入弹窗改名（注册时间也放在那个弹窗里——小字放不下，见下）。
export default function ProfileCard({ onEditName }: { onEditName: () => void }) {
  const { name } = useProfile()
  const stats = useDiaryOverview()

  // 只放「篇/天/字」：加上「始于 <日期>」在手机宽度下会被截断，
  // 注册时间因此移到改名弹窗里显示
  const parts: string[] = []
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
