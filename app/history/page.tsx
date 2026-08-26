'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import UnlockPrompt from '@/components/UnlockPrompt'
import { getDek } from '@/lib/client/session'
import { useRequireUnlock } from '@/lib/client/use-require-unlock'
import { decryptText } from '@/lib/client/crypto/encryption'

const PAGE_SIZE = 10

interface Entry {
  id: string
  ciphertext: string
  iv: string
  createdAt: string
  latitude: number | null
}

interface DecryptedItem {
  id: string
  createdAt: Date
  preview: string
  lat: number | null
}

interface Group {
  date: string
  items: { id: string; time: string; preview: string; lat: number | null }[]
}

export default function HistoryPage() {
  const router = useRouter()
  const { state: unlock, retryUnlock } = useRequireUnlock()
  const [items, setItems] = useState<DecryptedItem[]>([])
  const [stats, setStats] = useState<{ count: number; days: number } | null>(null)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 请求一页（offset 起 10 条）并解密
  const fetchPage = useCallback(async (pageOffset: number): Promise<DecryptedItem[]> => {
    const dek = getDek()
    if (!dek) return []
    const res = await fetch(`/api/diary?limit=${PAGE_SIZE}&offset=${pageOffset}`)
    if (!res.ok) throw new Error('加载失败')
    const { entries } = await res.json() as { entries: Entry[] }
    const decrypted: DecryptedItem[] = []
    for (const e of entries) {
      try {
        const plain = await decryptText(dek, e.ciphertext, e.iv)
        decrypted.push({ id: e.id, createdAt: new Date(e.createdAt), preview: plain.split('\n').find((l) => l.trim()) ?? '', lat: e.latitude })
      } catch {
        // 单条解密失败跳过（数据损坏不阻塞列表）
      }
    }
    return decrypted
  }, [])

  // 初始加载：统计 + 第一页
  useEffect(() => {
    if (unlock !== 'ready') return
    void (async () => {
      try {
        const [statsRes, firstPage] = await Promise.all([
          fetch('/api/diary/stats').then((r) => (r.ok ? r.json() : null)),
          fetchPage(0),
        ])
        if (statsRes) setStats(statsRes)
        setItems(firstPage)
        setOffset(PAGE_SIZE)
        setHasMore(firstPage.length === PAGE_SIZE) // 满页才可能还有更多
      } catch {
        setError('连接失败，请检查网络后重试')
      }
    })()
  }, [unlock, fetchPage])

  // 加载更多（点击按钮）
  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const page = await fetchPage(offset)
      setItems((prev) => [...prev, ...page])
      setOffset((o) => o + PAGE_SIZE)
      setHasMore(page.length === PAGE_SIZE)
    } catch {
      setError('连接失败，请检查网络后重试')
    } finally {
      setLoadingMore(false)
    }
  }

  // 按日期分组（基于已加载条目）
  const groups: Group[] = (() => {
    const sorted = [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    const grouped = new Map<string, DecryptedItem[]>()
    for (const item of sorted) {
      const key = item.createdAt.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
      grouped.set(key, [...(grouped.get(key) ?? []), item])
    }
    return [...grouped.entries()].map(([date, list]) => ({
      date,
      items: list.map((i) => ({
        id: i.id,
        time: i.createdAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
        preview: i.preview,
        lat: i.lat,
      })),
    }))
  })()

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

  if (unlock === 'need-unlock') return <UnlockPrompt onUnlock={() => void retryUnlock()} />
  if (unlock !== 'ready') return <main className="min-h-dvh px-5 safe-pt" />

  return (
    <main className="min-h-dvh px-5 safe-pt safe-pb">
      <header className="flex items-center justify-between py-3">
        {/* iOS 原生风格返回：chevron 箭头 + history.back */}
        <button onClick={() => router.back()} aria-label="返回" className="-ml-1 px-1 text-2xl leading-none text-neutral-400">
          ‹
        </button>
        <h1 className="text-lg font-semibold">历史</h1>
        <span className="w-8" />
      </header>
      {stats && (
        <p className="pb-2 text-xs tabular-nums text-neutral-400">
          共 {stats.count} 篇 · 写了 {stats.days} 天
        </p>
      )}
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
        {items.length === 0 && <p className="pt-20 text-center text-sm text-neutral-400">还没有日记</p>}
        {items.length > 0 && (
          <div className="pt-2">
            {hasMore ? (
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="w-full rounded-xl bg-neutral-100 py-3 text-sm text-neutral-500 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-400"
              >
                {loadingMore ? '加载中…' : '加载更多'}
              </button>
            ) : (
              <p className="py-3 text-center text-xs text-neutral-400">已显示全部</p>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
