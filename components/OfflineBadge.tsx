'use client'

import { usePathname } from 'next/navigation'
import { useOffline } from '@/lib/client/use-offline'

// 离线指示：断网时顶部悬浮的琥珀色小圆标（wifi-off 图标，在线时不占任何空间）。
// 告诉用户「现在看到的是本地缓存、写下的内容会联网后同步」——没有这个指示，
// 离线保存成功的反馈（「已离线保存」）缺少上下文，用户不知道发生了什么。
//
// 悬浮不占位（不把内容往下挤），但顶部左侧并非处处空闲，按页面选空位：
// - /diary、/settings：页头左侧空（标题绝对居中、控件在右）→ 左上
// - /（写页）：左上是 OrbitLogo → logo 行右侧（右上）
// - 子页（/entry/*、/settings/*）：左上是返回箭头 ‹ → 箭头右侧（left-14，避开 ‹ 与居中标题）
// 居中一律用 inset-x-0 + justify-center 或 left/right 锚定（居中 transform 的半像素
// 偏移会让图标发虚）。纯实色底（零模糊铁律），z-40（低于 z-50 弹窗/解锁提示），
// pointer-events-none（不挡触摸）。在线状态逻辑在 lib/client/use-offline.ts（共享 hook）。
export default function OfflineBadge() {
  const offline = useOffline()
  const pathname = usePathname()

  if (!offline) return null

  const headerTop = 'top-[calc(env(safe-area-inset-top)+10px)]'
  const posClass =
    pathname === '/'
      ? `right-4 top-[calc(env(safe-area-inset-top)+18px)]` // 写页：logo 行右侧空
      : pathname === '/diary' || pathname === '/settings'
        ? `left-4 ${headerTop}` // tab 目的地：页头左侧空
        : `left-14 ${headerTop}` // 子页：返回箭头右侧

  return (
    <div
      role="status"
      aria-label="离线模式"
      className={`pointer-events-none fixed z-40 ${posClass}`}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-white">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
          aria-hidden
        >
          <path d="M12 20h.01" />
          <path d="M8.5 16.429a5 5 0 0 1 7 0" />
          <path d="M5 12.859a10 10 0 0 1 5.17-2.69" />
          <path d="M19 12.859a10 10 0 0 1 2.007-1.523" />
          <path d="M2 8.82a15 15 0 0 1 4.177-2.643" />
          <path d="M22 8.82a15 15 0 0 0-11.288-3.764" />
          <path d="m2 2 20 20" />
        </svg>
      </span>
    </div>
  )
}
