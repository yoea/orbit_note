'use client'

import { useEffect, useState } from 'react'
import { STATS_SCOPE_EVENT, statsScopeQuery } from './prefs'

export interface DiaryOverview {
  count: number
  days: number
  words: number
}

// 写作统计（服务端全量聚合，与列表/热力图口径一致）。
// 模块级缓存 + inflight 去重：设置页的卡片与其它位置共用，只发一次请求。
let cached: DiaryOverview | null = null
let inflight: Promise<DiaryOverview | null> | null = null

export async function loadDiaryOverview(): Promise<DiaryOverview | null> {
  if (cached) return cached
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetch(`/api/diary/stats${statsScopeQuery()}`)
      if (!res.ok) return null
      const data = await res.json() as {
        count: number
        days: number
        byDay: Record<string, { count: number; words: number }>
      }
      cached = {
        count: data.count,
        days: data.days,
        words: Object.values(data.byDay ?? {}).reduce((sum, d) => sum + d.words, 0),
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

/**
 * 作废模块级缓存（2026-10-29）。
 *
 * 统计口径（「归档计入统计」）一变，这份缓存里的数字就是旧口径的 —— 不清掉的话，
 * 即便重新请求，`cached` 也会在函数第一行把它原样返回（"开关拨了、数字不动"）。
 */
export function invalidateDiaryOverview(): void {
  cached = null
  inflight = null
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

  // 口径切换 ⇒ 作废缓存并重新走上面那个 effect（`loaded=false` 就是它的触发条件）。
  // 不做这一步，"归档计入统计"拨完回到设置页，卡片上的篇数/天数/字数不会动。
  useEffect(() => {
    function onScopeChange() {
      invalidateDiaryOverview()
      setLoaded(false)
    }
    window.addEventListener(STATS_SCOPE_EVENT, onScopeChange)
    return () => window.removeEventListener(STATS_SCOPE_EVENT, onScopeChange)
  }, [])
  return data
}
