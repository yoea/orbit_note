'use client'

import { useEffect } from 'react'
import UnlockPrompt from '@/components/UnlockPrompt'
import TabBar from '@/components/TabBar'
import OfflineBadge from '@/components/OfflineBadge'
import { useRequireUnlock } from '@/lib/client/use-require-unlock'
import { initOfflineSync } from '@/lib/client/offline'

// 主应用区（登录后可访问的页面）共享布局：
//
// 1) 统一解锁守卫。此前 `/`、`/diary`、`/settings`、`/entry/[id]` 各自写一遍
//    useRequireUnlock，现在收敛到一处。放在 layout 还有个好处：同一路由组内切换
//    tab 时 layout 不会重新挂载，解锁检查不会每次重跑。
// 2) 底部 TabBar。route group 不改变 URL，所以 proxy.ts 的 matcher 与
//    proxy-guard.ts 的 protectedPaths 都无需改动。
//
// 布局：外层 wrapper 用 flex-1 + min-h-0 把可用高度限制成「容器高度 − TabBar 高度」，
// 页面在其中各自负责滚动（本项目页面都是容器滚动）。TabBar 走流内而非 fixed——
// 不遮挡内容，也不需要给每个页面补偿 padding。
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { state, retryUnlock } = useRequireUnlock()

  // 解锁完成 → 初始化离线同步（注册 online 监听 + 冲刷上次离线保存的队列；模块级单例）
  useEffect(() => {
    if (state === 'ready') initOfflineSync()
  }, [state])

  // 连接失败：原先只有 `/` 页面处理这个状态，/diary 与 /settings 会静默显示空白占位。
  // 收敛到 layout 后三个页面都能给出提示。
  if (state === 'error') {
    return (
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 pb-safe">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">连接失败，请检查网络后重试</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-6 py-3 text-sm font-medium text-white"
        >
          重试
        </button>
      </main>
    )
  }

  // 未解锁：只显示解锁提示，不渲染 TabBar（避免把用户带去同样需要解锁的页面）
  if (state === 'need-unlock') return <UnlockPrompt onUnlock={retryUnlock} />
  if (state !== 'ready') return <main className="flex-1 min-h-0 px-5 safe-pt" />

  return (
    <>
      {/* 离线指示：断网时顶部悬浮的琥珀色 wifi-off 圆标（在线时不渲染）。
          位置按页面自适应空位（见 OfflineBadge），悬浮不占内容空间 */}
      <OfflineBadge />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <TabBar />
    </>
  )
}
