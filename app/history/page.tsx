'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fetchSession, getDek } from '@/lib/client/session'
import { decryptText } from '@/lib/client/crypto/encryption'

interface Entry {
  id: string
  ciphertext: string
  iv: string
  createdAt: string
  latitude: number | null
}

interface Group {
  date: string
  items: { id: string; time: string; preview: string; lat: number | null }[]
}

export default function HistoryPage() {
  const router = useRouter()
  const [groups, setGroups] = useState<Group[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const s = await fetchSession()
        if (!s.authenticated || !getDek()) { router.replace('/login?from=/history'); return }
        const dek = getDek()!
        const res = await fetch('/api/diary?limit=200')
        if (!res.ok) throw new Error('加载失败')
        const { entries } = await res.json() as { entries: Entry[] }
        const decrypted: { id: string; createdAt: Date; preview: string; lat: number | null }[] = []
        for (const e of entries) {
          try {
            const plain = await decryptText(dek, e.ciphertext, e.iv)
            const preview = plain.split('\n').find((l) => l.trim()) ?? ''
            decrypted.push({ id: e.id, createdAt: new Date(e.createdAt), preview, lat: e.latitude })
          } catch {
            // 单条解密失败跳过（数据损坏不阻塞列表）
          }
        }
        const sorted = decrypted.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        const grouped = new Map<string, typeof decrypted>()
        for (const item of sorted) {
          const key = item.createdAt.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
          grouped.set(key, [...(grouped.get(key) ?? []), item])
        }
        setGroups([...grouped.entries()].map(([date, items]) => ({
          date,
          items: items.map((i) => ({
            id: i.id,
            time: i.createdAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
            preview: i.preview,
            lat: i.lat,
          })),
        })))
        setLoaded(true)
      } catch {
        setError('连接失败，请检查网络后重试')
      }
    })()
  }, [router])

  if (error) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-5 safe-pt safe-pb">
        <div className="text-center">
          <p className="text-sm text-neutral-500">{error}</p>
          <button onClick={() => window.location.reload()} className="mt-4 rounded-xl bg-neutral-900 px-6 py-3 text-sm font-medium text-white">重试</button>
        </div>
      </main>
    )
  }

  if (!loaded) return <main className="min-h-dvh px-5 safe-pt" />

  return (
    <main className="min-h-dvh px-5 safe-pt safe-pb">
      <header className="flex items-center justify-between py-3">
        <Link href="/" className="text-neutral-400">‹ 返回</Link>
        <h1 className="text-lg font-semibold">历史</h1>
        <span className="w-8" />
      </header>
      <div className="flex flex-col gap-6 pb-10">
        {groups.map((g) => (
          <section key={g.date}>
            <h2 className="mb-2 text-sm font-medium text-neutral-400">{g.date}</h2>
            <ul className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
              {g.items.map((item) => (
                <li key={item.id}>
                  <Link href={`/entry/${item.id}`} className="flex flex-col gap-0.5 py-3 active:opacity-60">
                    <span className="text-sm tabular-nums text-neutral-400">{item.time}</span>
                    <span className="line-clamp-2 whitespace-pre-wrap text-neutral-800 dark:text-neutral-200">{item.preview}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {groups.length === 0 && <p className="pt-20 text-center text-sm text-neutral-400">还没有日记</p>}
      </div>
    </main>
  )
}
