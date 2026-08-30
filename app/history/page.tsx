'use client'

import HistoryView from '@/components/HistoryView'
import PageTransition from '@/components/PageTransition'
import UnlockPrompt from '@/components/UnlockPrompt'
import { useRequireUnlock } from '@/lib/client/use-require-unlock'

export default function HistoryPage() {
  const { state, retryUnlock } = useRequireUnlock()

  if (state === 'need-unlock') return <UnlockPrompt onUnlock={retryUnlock} />
  if (state !== 'ready') return <main className="flex-1 min-h-0 px-5 safe-pt" />
  return (
    <PageTransition>
      <HistoryView />
    </PageTransition>
  )
}
