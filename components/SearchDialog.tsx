'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import SearchIcon from './SearchIcon'
import { getDek } from '@/lib/client/session'
import { decryptEntries, fetchAllEntries } from '@/lib/client/entries'
import {
  DEFAULT_FILTERS,
  TIME_RANGE_LABEL,
  buildSnippet,
  firstLine,
  highlightSegments,
  isDefaultFilters,
  matches,
  type TimeRange,
} from '@/lib/client/search'
import type { DecryptedEntry } from '@/lib/client/entries'

const TIME_RANGES: TimeRange[] = ['all', '7d', '30d', 'year']
// 单次最多渲染多少条——避免上千条时一次性建 DOM
const MAX_RENDERED = 100

// 命中片段的高亮渲染。用 <mark> 分段渲染，**不使用 dangerouslySetInnerHTML**（项目铁律）。
function Highlighted({ text, query }: { text: string; query: string }) {
  const segments = highlightSegments(text, query)
  return (
    <>
      {segments.map((s, i) => s.hit
        ? <mark key={i} className="rounded-[2px] bg-amber-200/70 text-inherit dark:bg-amber-400/25">{s.text}</mark>
        : <span key={i}>{s.text}</span>)}
    </>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors ${
        active
          ? 'bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 font-medium text-white'
          : 'bg-neutral-100 text-neutral-500 active:opacity-60 dark:bg-neutral-800 dark:text-neutral-400'
      }`}
    >
      {children}
    </button>
  )
}

// 搜索弹窗（/diary 右上角放大镜打开）。
//
// 正文是端到端加密的 ⇒ 服务端无法检索，只能把密文一次性拉到内存、解密后本地匹配。
// 因此：**首次输入时才拉取解密**（不是打开弹窗就做，也不是每敲一个字都做），
// 之后所有筛选与关键词匹配都在内存里完成，输入即出结果。
// 解密后的明文只存在本组件 state 中，关闭弹窗即释放——不写 IndexedDB / localStorage。
export default function SearchDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [range, setRange] = useState<TimeRange>('all')
  const [onlyWithLocation, setOnlyWithLocation] = useState(false)
  // null = 尚未加载（还没搜过）；加载完成后持有全部已解密条目
  const [entries, setEntries] = useState<DecryptedEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 打开即聚焦，省一次点击
  useEffect(() => { inputRef.current?.focus() }, [])

  // 按需加载：由输入/筛选的事件处理器触发，而不是 effect——
  // effect 里同步 setState 属于级联渲染（react-hooks/set-state-in-effect）。
  function ensureLoaded() {
    if (entries !== null || loading) return
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const dek = getDek()
        if (!dek) throw new Error('未解锁')
        setEntries(await decryptEntries(dek, await fetchAllEntries()))
      } catch {
        setError('搜索失败，请重试')
      } finally {
        setLoading(false)
      }
    })()
  }

  const filters = { query, range, onlyWithLocation }
  const active = !isDefaultFilters(filters)

  const results = useMemo(() => {
    if (!entries) return []
    return entries.filter((e) => matches(e.entry, e.plain, filters))
  }, [entries, query, range, onlyWithLocation]) // eslint-disable-line react-hooks/exhaustive-deps -- filters 每次渲染新建对象，按字段依赖更准确

  const visible = results.slice(0, MAX_RENDERED)
  const trimmedQuery = query.trim()

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-neutral-950">
      <div className="mx-auto w-full max-w-md shrink-0 px-5 safe-pt">
        <div className="flex items-center gap-3 py-3">
          {/* 输入框：复用应用既有的圆角浅底样式 */}
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-neutral-100 px-3 py-2.5 dark:bg-neutral-900">
            <span className="shrink-0 text-neutral-400"><SearchIcon className="h-4 w-4" /></span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); ensureLoaded() }}
              placeholder="搜索日记内容"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-neutral-400"
            />
            {query !== '' && (
              <button onClick={() => setQuery('')} aria-label="清除" className="shrink-0 text-sm text-neutral-400 active:opacity-60">✕</button>
            )}
          </div>
          <button onClick={onClose} className="shrink-0 text-sm text-neutral-400 active:opacity-60">取消</button>
        </div>
        {/* 筛选条件：与关键词是「与」的关系；时间与位置都是明文元数据 */}
        <div className="flex flex-wrap items-center gap-2 pb-3">
          {TIME_RANGES.map((r) => (
            <Chip key={r} active={range === r} onClick={() => { setRange(range === r ? 'all' : r); ensureLoaded() }}>
              {TIME_RANGE_LABEL[r]}
            </Chip>
          ))}
          <Chip active={onlyWithLocation} onClick={() => { setOnlyWithLocation(!onlyWithLocation); ensureLoaded() }}>
            有位置
          </Chip>
        </div>
      </div>

      <div className="mx-auto min-h-0 w-full max-w-md flex-1 overflow-y-auto px-5 safe-pb">
        {/* 未输入且未筛选：只给引导，不展示全部日记（那是列表页的职责） */}
        {!active && (
          <p className="pt-16 text-center text-sm text-neutral-400">输入关键词，或选择上面的筛选条件</p>
        )}

        {active && loading && <p className="pt-16 text-center text-sm text-neutral-400">正在解密日记…</p>}

        {active && !loading && error && (
          <div className="pt-16 text-center">
            <p className="text-sm text-red-500">{error}</p>
            <button
              onClick={() => { setEntries(null); ensureLoaded() }}
              className="mt-4 rounded-xl bg-neutral-100 px-6 py-2.5 text-sm font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            >
              重试
            </button>
          </div>
        )}

        {active && !loading && !error && entries !== null && (
          results.length === 0 ? (
            <p className="pt-16 text-center text-sm text-neutral-400">
              {trimmedQuery ? <>没有找到包含「{trimmedQuery}」的日记</> : '没有符合条件的日记'}
            </p>
          ) : (
            <>
              <p className="py-2 text-xs tabular-nums text-neutral-400">
                找到 {results.length} 篇{results.length > MAX_RENDERED && `（仅显示前 ${MAX_RENDERED} 篇）`}
              </p>
              {/* 结果项沿用列表页的视觉：左侧时间 + 标题 + 命中片段（高亮） */}
              <ul className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
                {visible.map(({ entry, plain }) => (
                  <li key={entry.id}>
                    <Link href={`/entry/${entry.id}`} className="flex flex-col gap-1 py-3 active:opacity-60">
                      <span className="flex items-baseline gap-2">
                        <span className="shrink-0 text-xs tabular-nums text-neutral-400">
                          {new Date(entry.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                        </span>
                        <span className="line-clamp-1 font-medium text-neutral-800 dark:text-neutral-200">
                          <Highlighted text={firstLine(plain) || '(无标题)'} query={trimmedQuery} />
                        </span>
                      </span>
                      <span className="line-clamp-2 whitespace-pre-wrap text-sm text-neutral-500 dark:text-neutral-400">
                        <Highlighted text={buildSnippet(plain, trimmedQuery)} query={trimmedQuery} />
                      </span>
                      {entry.locationName && (
                        <span className="text-xs text-neutral-400">
                          <span className="mr-0.5 text-[10px]">📍</span>
                          <Highlighted text={entry.locationName} query={trimmedQuery} />
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )
        )}
      </div>
    </div>
  )
}
