'use client'

import { useParams } from 'next/navigation'
import EntryView from '@/components/EntryView'
import PageTransition from '@/components/PageTransition'
import UnlockPrompt from '@/components/UnlockPrompt'
import { useRequireUnlock } from '@/lib/client/use-require-unlock'

export default function EntryPage() {
  const { id } = useParams<{ id: string }>()
  const { state, retryUnlock } = useRequireUnlock()

  if (state === 'need-unlock') return <UnlockPrompt onUnlock={retryUnlock} />
  if (state !== 'ready') return <main className="flex-1 min-h-0 px-5 safe-pt" />
  return (
    <PageTransition>
      <EntryView id={id} />
    </PageTransition>
  )
}
