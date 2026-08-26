'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import DiaryEditor from '@/components/DiaryEditor'
import { fetchSession, getDek } from '@/lib/client/session'

export default function HomePage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const s = await fetchSession()
        if (!s.initialized) { router.replace('/setup'); return }
        if (!s.authenticated) { router.replace('/login?reason=no-auth'); return }
        if (!getDek()) { router.replace('/login?reason=no-dek'); return }
        setReady(true)
      } catch {
        // 网络/服务错误：绝不走初始化分支，停留在本页提示
        setLoadError(true)
      }
    })()
  }, [router])

  if (loadError) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 safe-pb">
        <p className="text-sm text-neutral-500">连接失败，请检查网络后重试</p>
        <button onClick={() => window.location.reload()} className="rounded-xl bg-neutral-900 px-6 py-3 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">
          重试
        </button>
      </main>
    )
  }

  if (!ready) return null
  return <DiaryEditor />
}
