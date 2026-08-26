'use client'

import SettingsView from '@/components/SettingsView'
import UnlockPrompt from '@/components/UnlockPrompt'
import { useRequireUnlock } from '@/lib/client/use-require-unlock'

export default function SettingsPage() {
  const { state, retryUnlock } = useRequireUnlock()

  if (state === 'need-unlock') return <UnlockPrompt onUnlock={() => void retryUnlock()} />
  if (state !== 'ready') return <main className="min-h-dvh px-5 safe-pt" />
  return <SettingsView />
}
