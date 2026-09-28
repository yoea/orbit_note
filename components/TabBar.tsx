'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { activeTab, type TabHref } from '@/lib/client/nav'

// 底部导航：三个平级目的地（写 / 日记 / 设置），取代原先全局的 AppFooter——
// 版本号与版权在「关于」弹窗里本来就有，移除页脚不丢失任何信息。
//
// 实色底而非 iOS 26/27 那种 Liquid Glass 毛玻璃：本项目刻意零 backdrop-filter /
// filter / mask（安全审计要求；此前排查 iOS 27 PWA 顶部虚化问题时也确认过模糊只可能
// 来自系统合成器）。引入模糊属性会重新踩那类系统级渲染坑，得不偿失。
//
// 流内布局（body 是 flex-col）——不遮挡内容，也不需要 fixed + 给内容补 padding。
// 底部安全区由本组件承担，因此 (app) 内的页面不再需要 safe-pb。

// 图标与 SearchIcon 同风格（Feather/Lucide：24 网格、currentColor、stroke 2、圆头圆角）
function PenIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function BookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </svg>
  )
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  )
}

const TABS: { href: TabHref; label: string; Icon: (p: { className?: string }) => React.JSX.Element }[] = [
  { href: '/', label: '写', Icon: PenIcon },
  { href: '/diary', label: '日记', Icon: BookIcon },
  { href: '/settings', label: '设置', Icon: GearIcon },
]

export default function TabBar() {
  const pathname = usePathname()
  const current = activeTab(pathname)

  return (
    <nav className="shrink-0 border-t border-neutral-100 bg-white pb-safe dark:border-neutral-800 dark:bg-neutral-950">
      <ul className="mx-auto flex w-full max-w-md">
        {TABS.map(({ href, label, Icon }) => {
          const active = current === href
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                // aria-current 让读屏软件知道当前所在页
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 text-[10px] active:opacity-60 ${
                  active ? 'font-medium text-neutral-900 dark:text-neutral-100' : 'text-neutral-400'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
