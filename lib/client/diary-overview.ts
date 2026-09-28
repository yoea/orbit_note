'use client'

import { useEffect, useState } from 'react'

export interface DiaryOverview {
  count: number
  days: number
  words: number
  /** 最早一篇日记的日期（yyyy-mm-dd），用于「始于」的回退显示 */
  firstDay: string | null
}

// 日期只展示到「年月日」。
// 需要区分两种输入：ISO 时间戳（注册时间，含 T，必须做本地时区换算，
// 否则 UTC 日期可能比本地日期早一天）与纯日期串（yyyy-mm-dd）。
export function formatYmd(value: string): string {
  if (value.includes('T')) {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (m) return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`
  return value
}

// 写作统计（服务端全量聚合，与列表/热力图口径一致）。
// 模块级缓存 + 去重：设置页的卡片与改名弹窗都要用，只发一次请求。
let cached: DiaryOverview | null = null
let inflight: Promise<DiaryOverview | null> | null = null

export async function loadDiaryOverview(): Promise<DiaryOverview | null> {
  if (cached) return cached
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetch('/api/diary/stats')
      if (!res.ok) return null
      const data = await res.json() as {
        count: number
        days: number
        byDay: Record<string, { count: number; words: number }>
      }
      const byDay = data.byDay ?? {}
      cached = {
        count: data.count,
        days: data.days,
        words: Object.values(byDay).reduce((sum, d) => sum + d.words, 0),
        firstDay: Object.keys(byDay).sort()[0] ?? null,
      }
      return cached
    } catch {
      return null
    } finally {
      inflight = null
    }
  })()
  return inflight
}

// 失败时返回 null——调用方应整行隐藏，绝不显示 0（会让人以为日记没了）
export function useDiaryOverview(): DiaryOverview | null {
  const [data, setData] = useState<DiaryOverview | null>(cached)
  // loaded 必须独立于 data：请求失败时 data 恒为 null，若只看 data 会无限重试
  const [loaded, setLoaded] = useState(cached !== null)
  useEffect(() => {
    if (loaded) return
    let alive = true
    void loadDiaryOverview().then((d) => {
      if (!alive) return
      if (d) setData(d)
      setLoaded(true)
    })
    return () => { alive = false }
  }, [loaded])
  return data
}
