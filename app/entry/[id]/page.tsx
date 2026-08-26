'use client'

import { useParams } from 'next/navigation'
import EntryView from '@/components/EntryView'
import UnlockPrompt from '@/components/UnlockPrompt'
import { useRequireUnlock } from '@/lib/client/use-require-unlock'

export default function EntryPage() {
  const { id } = useParams<{ id: string }>()
  const { state, retryUnlock } = useRequireUnlock()

  if (state === 'need-unlock') return <UnlockPrompt onUnlock={retryUnlock} />
  if (state !== 'ready') return <main className="min-h-dvh px-5 safe-pt" />
  return <EntryView id={id} />
}
