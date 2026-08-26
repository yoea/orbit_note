'use client'

import { useCallback, useEffect, useState } from 'react'
import DiaryEditor from '@/components/DiaryEditor'
import HistoryView from '@/components/HistoryView'
import EntryView from '@/components/EntryView'
import SettingsView from '@/components/SettingsView'
import UnlockPrompt from '@/components/UnlockPrompt'
import { useRequireUnlock } from '@/lib/client/use-require-unlock'

// 视图状态机：首页承载全部视图（编辑器/历史/详情/设置），状态机内切换——
// 不触发页面导航/重载（iOS PWA standalone 中 Next 导航会重载页面、丢失内存解锁状态）。
// 每次切换用 history.pushState（hash 形式）同步历史记录——pushState 是纯客户端 API，
// 不重载页面；iOS 右滑返回/浏览器后退触发 popstate → 恢复对应视图，原生手势可用。
type View = { name: 'editor' } | { name: 'history' } | { name: 'entry'; id: string } | { name: 'settings' }

function viewToHash(v: View): string {
  switch (v.name) {
    case 'editor': return '#/'
    case 'history': return '#/history'
    case 'entry': return `#/entry/${v.id}`
    case 'settings': return '#/settings'
  }
}

function hashToView(hash: string): View | null {
  if (hash === '' || hash === '#') return { name: 'editor' } // 空 hash = 默认编辑器视图（右滑回到初始记录）
  if (hash === '#/history') return { name: 'history' }
  if (hash.startsWith('#/entry/')) {
    const id = hash.slice('#/entry/'.length)
    if (id) return { name: 'entry', id }
    return null
  }
  if (hash === '#/settings') return { name: 'settings' }
  return null
}

export default function HomePage() {
  const [view, setView] = useState<View>({ name: 'editor' })
  const { state: unlock, retryUnlock } = useRequireUnlock()

  // 切换视图：更新状态 + pushState 同步历史（供右滑返回/浏览器后退恢复）
  const navigate = useCallback((v: View) => {
    setView(v)
    try {
      window.history.pushState({ view: v.name }, '', viewToHash(v))
    } catch { /* 忽略（隐私模式等） */ }
  }, [])

  // 返回：状态机层级回退（entry→history→editor，settings→editor），并用 replaceState 修正 hash，
  // 使历史记录与视图保持一致（后续右滑 popstate 恢复的也是正确视图）；深链场景不离开应用。
  const goBack = useCallback(() => {
    setView((prev) => {
      const next: View = prev.name === 'history' || prev.name === 'settings'
        ? { name: 'editor' }
        : prev.name === 'entry' ? { name: 'history' } : prev
      try { window.history.replaceState({ view: next.name }, '', viewToHash(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  // 右滑返回 / 浏览器后退：popstate → 按 hash 恢复视图
  useEffect(() => {
    let suppressPop = false
    const onPop = () => {
      if (suppressPop) { suppressPop = false; return } // 自定义手势已处理本次返回
      const v = hashToView(window.location.hash)
      if (v) setView(v)
    }
    window.addEventListener('popstate', onPop)

    // PWA（standalone）兜底：iOS 原生右滑可能只播放动画不触发 popstate——
    // 自行检测"屏幕左缘开始、向右滑动"手势执行返回。Safari 中依赖原生手势+popstate（不注册，避免双回退）。
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    let startX = 0
    let startY = 0
    if (isStandalone) {
      const onTouchStart = (e: TouchEvent) => {
        const t = e.touches[0]
        startX = t.clientX
        startY = t.clientY
      }
      const onTouchEnd = (e: TouchEvent) => {
        const t = e.changedTouches[0]
        const dx = t.clientX - startX
        const dy = t.clientY - startY
        // 左缘开始 + 右滑 > 60px + 垂直偏移小（水平返回手势）
        if (startX < 25 && dx > 60 && Math.abs(dy) < 60) {
          suppressPop = true
          setTimeout(() => { suppressPop = false }, 600)
          goBack()
        }
      }
      document.addEventListener('touchstart', onTouchStart, { passive: true })
      document.addEventListener('touchend', onTouchEnd, { passive: true })
      return () => {
        window.removeEventListener('popstate', onPop)
        document.removeEventListener('touchstart', onTouchStart)
        document.removeEventListener('touchend', onTouchEnd)
      }
    }

    // 深链/刷新恢复：初始 hash 非默认时直接呈现对应视图（不 push，当前记录即该视图）
    const initial = hashToView(window.location.hash)
    if (initial) setView(initial)
    return () => window.removeEventListener('popstate', onPop)
  }, [goBack])

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
          onBack={goBack}
          onOpenEntry={(id) => navigate({ name: 'entry', id })}
        />
      )
    case 'entry':
      return <EntryView id={view.id} onBack={goBack} />
    case 'settings':
      return <SettingsView onBack={goBack} />
    default:
      return (
        <DiaryEditor
          onOpenHistory={() => navigate({ name: 'history' })}
          onOpenSettings={() => navigate({ name: 'settings' })}
        />
      )
  }
}
