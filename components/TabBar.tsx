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
//
// 选中态用品牌主题色（全站「激活/主色」统一是这条渐变：开关 ON、主按钮、头像、
// 连续天数文字…），而非灰度黑/白——否则导航栏是页面里唯一「高亮却不是主题色」的地方。

// 品牌渐变：色值直接引用 Tailwind 调色板变量（--color-*），保证与 class 版渐变
// （from-orange-500 via-rose-400 to-violet-500）严格同色，将来改主题只改一处。
const BRAND_CLASS = 'bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500'
const GRADIENT_ID = 'qo-tab-accent'

// 渐变描边定义。为什么图标不能只靠文字色：
// 选中标签用 bg-clip-text + text-transparent 实现渐变文字，此时 currentColor 是透明，
// 图标（stroke="currentColor"）会整个消失——必须让 SVG 显式引用这个渐变。
// 尺寸 0 的隐藏 svg 放在 nav 里，一次即可。
function AccentGradientDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
      <defs>
        <linearGradient id={GRADIENT_ID} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-orange-500)" />
          <stop offset="50%" stopColor="var(--color-rose-400)" />
          <stop offset="100%" stopColor="var(--color-violet-500)" />
        </linearGradient>
      </defs>
    </svg>
  )
}

// 图标与 SearchIcon 同风格（Feather/Lucide：24 网格、stroke 2、圆头圆角）。
// accent=true 时改用渐变描边（见 GRADIENT_ID 注释）。
function PenIcon({ className, accent }: { className?: string; accent?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={accent ? `url(#${GRADIENT_ID})` : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function BookIcon({ className, accent }: { className?: string; accent?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={accent ? `url(#${GRADIENT_ID})` : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </svg>
  )
}

function GearIcon({ className, accent }: { className?: string; accent?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={accent ? `url(#${GRADIENT_ID})` : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  )
}

const TABS: { href: TabHref; label: string; Icon: (p: { className?: string; accent?: boolean }) => React.JSX.Element }[] = [
  { href: '/', label: '写', Icon: PenIcon },
  { href: '/diary', label: '日记', Icon: BookIcon },
  { href: '/settings', label: '设置', Icon: GearIcon },
]

export default function TabBar() {
  const pathname = usePathname()
  const current = activeTab(pathname)

  return (
    <nav className="shrink-0 border-t border-neutral-100 bg-white pb-safe dark:border-neutral-800 dark:bg-neutral-950">
      <AccentGradientDefs />
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
                  active ? 'font-medium' : 'text-neutral-400'
                }`}
              >
                <Icon className="h-5 w-5" accent={active} />
                <span className={active ? `${BRAND_CLASS} bg-clip-text text-transparent` : undefined}>{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
