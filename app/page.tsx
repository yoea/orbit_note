'use client'

import DiaryEditor from '@/components/DiaryEditor'
import UnlockPrompt from '@/components/UnlockPrompt'
import { useRequireUnlock } from '@/lib/client/use-require-unlock'

export default function HomePage() {
  const { state, retryUnlock } = useRequireUnlock()

  if (state === 'error') {
    return (
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 safe-pb">
        <p className="text-sm text-neutral-500">连接失败，请检查网络后重试</p>
        <button onClick={() => window.location.reload()} className="rounded-xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-6 py-3 text-sm font-medium text-white">
          重试
        </button>
      </main>
    )
  }

  if (state === 'need-unlock') return <UnlockPrompt onUnlock={retryUnlock} />
  if (state !== 'ready') return null
  return <DiaryEditor />
}
