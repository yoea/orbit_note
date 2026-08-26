'use client'

import SettingsView from '@/components/SettingsView'
import UnlockPrompt from '@/components/UnlockPrompt'
import { useRequireUnlock } from '@/lib/client/use-require-unlock'

export default function SettingsPage() {
  const { state, retryUnlock } = useRequireUnlock()

  if (state === 'need-unlock') return <UnlockPrompt onUnlock={retryUnlock} />
  if (state !== 'ready') return <main className="flex-1 min-h-0 px-5 safe-pt" />
  return <SettingsView />
}
