'use client'

import { useState } from 'react'
import DiaryEditor from '@/components/DiaryEditor'
import HistoryView from '@/components/HistoryView'
import EntryView from '@/components/EntryView'
import SettingsView from '@/components/SettingsView'
import UnlockPrompt from '@/components/UnlockPrompt'
import { useRequireUnlock } from '@/lib/client/use-require-unlock'

// 视图状态机：首页承载全部视图（编辑器/历史/详情/设置），状态机内切换——
// 不改变 URL、不触发页面导航。iOS PWA（standalone）中任何导航（含客户端 pushState）
// 都会导致页面重载、内存解锁状态（DEK）丢失，从而每次导航都要求 Face ID。
// 状态机切换无重载，解锁一次全程有效。
type View = { name: 'editor' } | { name: 'history' } | { name: 'entry'; id: string } | { name: 'settings' }

export default function HomePage() {
  const [view, setView] = useState<View>({ name: 'editor' })
  const { state: unlock, retryUnlock } = useRequireUnlock()

  if (unlock === 'error') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 safe-pb">
        <p className="text-sm text-neutral-500">连接失败，请检查网络后重试</p>
        <button onClick={() => window.location.reload()} className="rounded-xl bg-neutral-900 px-6 py-3 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">
          重试
        </button>
      </main>
    )
  }

  if (unlock === 'need-unlock') return <UnlockPrompt onUnlock={() => void retryUnlock()} />
  if (unlock !== 'ready') return null

  switch (view.name) {
    case 'history':
      return (
        <HistoryView
          onBack={() => setView({ name: 'editor' })}
          onOpenEntry={(id) => setView({ name: 'entry', id })}
        />
      )
    case 'entry':
      return <EntryView id={view.id} onBack={() => setView({ name: 'history' })} />
    case 'settings':
      return <SettingsView onBack={() => setView({ name: 'editor' })} />
    default:
      return (
        <DiaryEditor
          onOpenHistory={() => setView({ name: 'history' })}
          onOpenSettings={() => setView({ name: 'settings' })}
        />
      )
  }
}
