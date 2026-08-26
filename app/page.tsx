'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import DiaryEditor from '@/components/DiaryEditor'
import { fetchSession, getDek } from '@/lib/client/session'

export default function HomePage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void (async () => {
      const s = await fetchSession()
      if (!s.initialized) { router.replace('/setup'); return }
      if (!s.authenticated) { router.replace('/login'); return }
      if (!getDek()) { router.replace('/login'); return }
      setReady(true)
    })()
  }, [router])

  if (!ready) return null
  return <DiaryEditor />
}
