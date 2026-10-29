'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { getDek } from '@/lib/client/session'
import { decryptText } from '@/lib/client/crypto/encryption'
import { cacheEntriesPage, getCachedEntries, getQueuedEntries, patchCachedEntries, unionWithPending } from '@/lib/client/offline'
import { bulkErrorText, postBulkArchive } from '@/lib/client/bulk-ops'
import { displayLocationName } from '@/lib/client/location'
import { deriveTitlePreview, toPlainText } from '@/lib/client/markdown'
import { daysAgoLabel } from '@/lib/client/archive'
import { useOffline } from '@/lib/client/use-offline'
import Toast from './Toast'
import ConfirmDialog from './ConfirmDialog'
import BulkActionBar from './BulkActionBar'
import SelectDot from './SelectDot'

// 归档列表（/settings/archive）。
//
// 为什么是独立页而不是列表页的第二种视图模式（方案阶段 2 的定稿）：
// 列表页背着一整套「固定区（标题栏+统计+热力图）+ 内部滚动 + 滚动位置恢复 + 会话快照」，
// 再塞一个视图模式进去，每个都要变成两份分支。归档页是需要时才进的子页面，
// 组件可以彻底重新挂载、从头加载。
//
// ★ 三条与列表页刻意不同的地方，改之前先读：
//   1. **绝不调用 pruneCachedEntries**。prune 的语义是「服务器全量清单里没有的 ⇒ 已删除」，
//      而这里拿到的是**全表的一个子集**（archived=only）。照抄列表页那行会把所有未归档条目
//      当成「已删除」从缓存里清掉 —— 表现为「去了趟归档页，离线列表全空了」，且零报错。
//   2. **不显示字数、改显示「归档于 X 天前」**。字数在阅读场景有用；归档页是回溯场景，
//      「什么时候收进来的」才是要找的信息。
//   3. **不做滚动位置恢复 / 会话快照**。归档条目预期是「几十条」量级，
//      真到成百上千再补，那时与列表页同一套（`qo-diary-scroll` + 深度重取）。
//   4. **不显示收藏星标**。`tests/entry-star.test.ts` 的 S1 把星图标限定在
//      「列表页 / 详情页」两处（收藏是「这一篇的状态」，处处都画会让人以为它们各自独立）。
//      归档页是回溯场景，星标帮不上忙 —— 与其放宽那条守卫，不如这里不画。

const PAGE_SIZE = 20

// 与 API 返回同构的整行（离线缓存按整行存取，字段少一个就会在写缓存时丢值）
interface Entry {
  id: string
  ciphertext: string
  iv: string
  createdAt: string
  updatedAt: string
  wordCount: number
  latitude: number | null
  longitude: number | null
  locationAccuracy: number | null
  locationProvince: string | null
  locationCity: string | null
  locationDistrict: string | null
  locationName: string | null
  weather: string | null
  timezone: string | null
  starred: boolean
  archivedAt: string | null
  viewCount: number
}

interface DecryptedItem {
  id: string
  createdAt: Date
  /** 归档时间（ISO）。本页只会有非空值，但类型保持可空——离线缓存里可能混进脏数据 */
  archivedAt: string | null
  title: string
  preview: string
  locationName: string | null
  pending: boolean
}

/** 游标 = 「已经取过的最旧一条」。与列表页同一套：(createdAt, id) 全序，同秒不会整批跳过 */
interface Cursor {
  at: string
  id: string
}


// 行内的「创建日期 + 时刻」：`2026年10月12日 17:26`。
// 只用 toLocaleDateString 会丢掉时刻，而归档列表里同一天可能有好几篇。
function fmtDateTime(d: Date): string {
  const day = d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${day} ${time}`
}

export default function ArchiveListView() {
  const [items, setItems] = useState<DecryptedItem[]>([])
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const offline = useOffline()

  // —— 批量取消归档（2026-10-29，阶段 4）——
  // 与列表页的批量归档对称：那边收进去，这边放出来。
  // 没有它的话，用户要把几十篇从归档里放回日常，只能一篇篇点进去再点取消。
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [confirmBulk, setConfirmBulk] = useState(false)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [sentinelEl, setSentinelEl] = useState<HTMLDivElement | null>(null)
  const cursorRef = useRef<Cursor | null>(null)
  const hasMoreRef = useRef(true)
  const fetchingRef = useRef(false)

  useEffect(() => { cursorRef.current = cursor }, [cursor])
  useEffect(() => { hasMoreRef.current = hasMore }, [hasMore])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  function exitSelect() {
    setSelectMode(false)
    setSelected(new Set())
  }

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 批量取消归档：当前视图是「已归档」⇒ 成功的要从本页移除，
  // 同时把本地缓存里的 archivedAt 改回 null（否则离线进归档页它们还在）。
  async function submitBulkUnarchive() {
    if (bulkBusy || selected.size === 0) return
    setBulkBusy(true)
    const ids = [...selected]
    try {
      const res = await postBulkArchive(ids, false)
      const gone = new Set(ids)
      setItems((prev) => prev.filter((i) => !gone.has(i.id)))
      const stillThere = ids.filter((id) => !res.missing.includes(id))
      await patchCachedEntries(stillThere, { archivedAt: null })
      if (res.missing.length) setToast(`已取消归档 ${res.updated} 篇，另有 ${res.missing.length} 篇已不存在`)
      else if (res.updated === 0) setToast('选中的日记没有归档状态')
      else setToast(`已取消归档 ${res.updated} 篇`)
      setConfirmBulk(false)
      exitSelect()
    } catch (e) {
      setToast(bulkErrorText(e, '取消归档'))
    } finally {
      setBulkBusy(false)
    }
  }

  // 取一页并解密。数据源：在线 = 服务器(archived=only) ∪ 队列里已归档的未同步笔记；
  // 离线 = 本地缓存里 archivedAt 非空的 ∪ 队列里已归档的。
  const fetchPage = useCallback(async (from: Cursor | null): Promise<{ items: DecryptedItem[]; serverCount: number; cursor: Cursor | null }> => {
    const dek = getDek()
    if (!dek) return { items: [], serverCount: 0, cursor: null }
    let entries: Entry[]
    let serverCount: number
    let nextCursor: Cursor | null = null
    const queued = await getQueuedEntries()
    // 离线归档过的笔记（队列里带 archivedAt）也属于「已归档」——不并进来，
    // 用户会以为「刚归档的那篇不见了」。
    const queuedArchived = queued.filter((q) => q.archivedAt != null)
    let pendingIds = new Set<string>()

    const qs = from
      ? `&before=${encodeURIComponent(from.at)}&beforeId=${encodeURIComponent(from.id)}`
      : ''
    const res = await fetch(`/api/diary?archived=only&limit=${PAGE_SIZE}${qs}`).catch(() => null)
    if (res) {
      if (!res.ok) throw new Error('加载失败')
      const server = ((await res.json()) as { entries: Entry[] }).entries
      serverCount = server.length
      // await：与列表页同一条不变量——**列表里出现过的，本地必须已有密文**（离线可读性）
      await cacheEntriesPage(server)
      // ★ 这里**没有** pruneCachedEntries，而且不能加（见文件头第 1 条）
      const serverIds = new Set(server.map((e) => e.id))
      pendingIds = new Set(queuedArchived.filter((q) => !serverIds.has(q.id)).map((q) => q.id))
      // 未同步条目只可能落在第一页（时间戳都是「现在」）
      entries = from === null ? unionWithPending(server, queuedArchived) : server
      const last = server[server.length - 1]
      nextCursor = last ? { at: last.createdAt, id: last.id } : null
    } else {
      // 网络不可达：只有本地缓存能看。**这不是错误状态**——能读到几条就先给几条。
      const cached = (await getCachedEntries()).filter((e) => e.archivedAt != null)
      const union = unionWithPending(cached, queuedArchived)
      let startIdx = 0
      if (from) {
        const byId = union.findIndex((e) => e.id === from.id)
        if (byId >= 0) startIdx = byId + 1
        else {
          const byTime = union.findIndex((e) => e.createdAt < from.at)
          startIdx = byTime >= 0 ? byTime : union.length
        }
      }
      const slice = union.slice(startIdx, startIdx + PAGE_SIZE)
      entries = slice
      serverCount = slice.length
      if (!slice.length && from === null) return { items: [], serverCount: 0, cursor: null }
      pendingIds = new Set(queuedArchived.map((q) => q.id))
      const last = slice[slice.length - 1]
      nextCursor = slice.length && startIdx + slice.length < union.length
        ? { at: last.createdAt, id: last.id }
        : null
    }

    const decrypted: DecryptedItem[] = []
    for (const e of entries) {
      try {
        const plain = await decryptText(dek, e.ciphertext, e.iv)
        const text = toPlainText(plain)
        const { title, preview } = deriveTitlePreview(text)
        decrypted.push({
          id: e.id,
          createdAt: new Date(e.createdAt),
          archivedAt: e.archivedAt,
          title,
          preview,
          locationName: displayLocationName(e),
          pending: pendingIds.has(e.id),
        })
      } catch {
        // 单条解密失败跳过（数据损坏不阻塞整页）
      }
    }
    return { items: decrypted, serverCount, cursor: nextCursor }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const first = await fetchPage(null)
        setItems(first.items)
        setCursor(first.cursor)
        setHasMore(first.serverCount === PAGE_SIZE)
      } catch {
        setError('连接失败，请检查网络后重试')
      } finally {
        setLoading(false)
      }
    })()
  }, [fetchPage])

  const loadOlder = useCallback(async () => {
    if (fetchingRef.current || !hasMoreRef.current) return
    const from = cursorRef.current
    if (!from) return
    fetchingRef.current = true
    setLoadingMore(true)
    try {
      const page = await fetchPage(from)
      setItems((prev) => [...prev, ...page.items])
      setCursor(page.cursor)
      setHasMore(page.serverCount === PAGE_SIZE)
    } catch {
      // 触底失败不整页报错（可能只是网络抖动），给一次性提示
      setToast('离线状态无法继续加载更早的归档日记')
      setHasMore(false)
    } finally {
      fetchingRef.current = false
      setLoadingMore(false)
    }
  }, [fetchPage])

  // 触底自动加载：root 必须是本页的滚动容器（本页不是 window 滚动，用默认 root 永不触发）
  useEffect(() => {
    const root = scrollRef.current
    if (!sentinelEl || !root || !hasMore) return
    const io = new IntersectionObserver((ent) => {
      if (ent.some((e) => e.isIntersecting)) void loadOlder()
    }, { root, rootMargin: '400px 0px' })
    io.observe(sentinelEl)
    return () => io.disconnect()
  }, [sentinelEl, hasMore, loadOlder])

  // 行内容：**标题 + 创建日期 + 归档日期**（2026-10-29 用户要求：不要正文预览）。
  //
  // 去掉预览后一行只有两段信息 —— 列表更短，也更能"数"清归档了多少篇。
  // 按天分组同时取消：既然每行都带完整日期，组头就只是把同一串再写一遍。
  function rowBody(item: DecryptedItem) {
    return (
      <>
        <span className="flex items-baseline gap-2">
          <span className="line-clamp-1 font-medium text-neutral-800 dark:text-neutral-200">
            {item.title || '(无标题)'}
          </span>
          {item.pending && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden>
                <path d="M17.5 19a4.5 4.5 0 1 0 0-9h-1.8A7 7 0 1 0 4 14.7" />
                <line x1="2" y1="2" x2="22" y2="22" />
              </svg>
              未同步
            </span>
          )}
        </span>
        <span className="text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400">
          {fmtDateTime(item.createdAt)} · 归档于 {daysAgoLabel(item.archivedAt ?? '') || '已归档'}
        </span>
      </>
    )
  }


  if (error) {
    return (
      <main className="mx-auto flex h-full w-full max-w-md items-center justify-center px-5">
        <div className="text-center">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{error}</p>
          <button onClick={() => window.location.reload()} className="mt-4 rounded-xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-6 py-3 text-sm font-medium text-white">重试</button>
        </div>
      </main>
    )
  }

  return (
    /* 布局与列表页同构（固定页头 + 内部滚动区），但**没有**统计行与热力图：
       归档条目不参与统计（stats 与 on-this-day 都已排除），在这里再显示一遍会自相矛盾。 */
    <main className="mx-auto flex h-full w-full max-w-md flex-col">
      <header className="page-header relative flex shrink-0 items-center justify-between px-5 py-3">
        {/* 返回设置页（本页从设置页进）。标题绝对居中、右侧留等宽占位保持行高 */}
        <Link href="/settings" aria-label="返回" scroll={false} className="-ml-1 px-1 text-3xl leading-none text-neutral-500 dark:text-neutral-400">
          ‹
        </Link>
        <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold">已归档</h1>
        {selectMode ? (
          <button onClick={exitSelect} className="px-1 text-sm font-medium text-neutral-500 active:opacity-60 dark:text-neutral-400">完成</button>
        ) : items.length > 0 ? (
          /* 有内容才给「选择」入口：空列表上放一个点了没反应的按钮没有意义 */
          <button onClick={() => setSelectMode(true)} className="px-1 text-sm text-neutral-500 active:opacity-60 dark:text-neutral-400">选择</button>
        ) : (
          <span className="w-8" aria-hidden />
        )}
      </header>
      {/* 口径说明常驻一行：用户把某天唯一一篇归档后，连续写作天数会断
          （统计全部排除是该功能的既定取舍）。不写这一行，那会被当成 bug 报回来。 */}
      <p className="shrink-0 px-5 pb-3 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
        归档的日记不计入热力图、连续写作天数与日常列表。
      </p>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5">
        <div className="flex flex-col gap-6 pb-4">
          <ul className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
            {items.map((item) => (
              <li key={item.id}>
                {selectMode ? (
                  <button
                    onClick={() => toggleItem(item.id)}
                    aria-pressed={selected.has(item.id)}
                    className="flex w-full items-start gap-2.5 py-3 text-left active:opacity-60"
                  >
                    <SelectDot checked={selected.has(item.id)} />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">{rowBody(item)}</span>
                  </button>
                ) : (
                  /* ?from=archive：详情页据此把返回箭头与「删除后跳转」指回本页
                     （不带的话会一律回 /diary，用户从归档页点开一篇就回不来了） */
                  <Link href={`/entry/${item.id}?from=archive`} className="flex flex-col gap-1 py-3 active:opacity-60">
                    {rowBody(item)}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {/* 空态。离线时要说清楚「这只是本机缓存」——否则用户会以为归档的日记丢了 */}
          {!loading && items.length === 0 && (
            <div className="pt-16 text-center">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">还没有归档的日记</p>
              <p className="mt-2 px-6 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                {offline
                  ? '离线模式下只能看到本机已缓存的归档日记，联网后再看看。'
                  : '在日记详情页点底部的归档图标（收纳盒），它就会收进这里。'}
              </p>
            </div>
          )}
          {items.length > 0 && (
            <div className="pt-2">
              {hasMore ? (
                <>
                  <div ref={setSentinelEl} aria-hidden className="h-1" />
                  <p className="py-3 text-center text-xs text-neutral-500 dark:text-neutral-400">
                    {loadingMore ? '加载中…' : ''}
                  </p>
                </>
              ) : (
                <p className="py-3 text-center text-xs text-neutral-500 dark:text-neutral-400">已显示全部</p>
              )}
            </div>
          )}
        </div>
      </div>
      {selectMode && (
        <BulkActionBar
          count={selected.size}
          busy={bulkBusy}
          label="取消归档"
          busyLabel="处理中…"
          onAction={() => setConfirmBulk(true)}
          onCancel={exitSelect}
        />
      )}

      {toast && <Toast message={toast} />}
      {confirmBulk && (
        <ConfirmDialog
          title={`取消归档这 ${selected.size} 篇日记？`}
          message="它们会回到列表、搜索与统计里。"
          confirmText="取消归档"
          cancelText="取消"
          onConfirm={() => void submitBulkUnarchive()}
          onCancel={() => setConfirmBulk(false)}
        />
      )}
    </main>
  )
}
