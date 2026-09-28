'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import AutoTextarea from './AutoTextarea'
import ConfettiBurst from './ConfettiBurst'
import OrbitLogo from './OrbitLogo'
import { getDek } from '@/lib/client/session'
import { decryptText, encryptText } from '@/lib/client/crypto/encryption'
import { getPosition } from '@/lib/client/location'
import { isAutoPlaceNameEnabled, isLocationEnabled, isOnThisDayEnabled, isPromptEnabled, isStreakEnabled, isWeatherEnabled } from '@/lib/client/prefs'
import { clientReverseGeocode } from '@/lib/client/geocode'
import { fetchWeather } from '@/lib/client/weather'
import { playSaveSound } from '@/lib/client/sound'
import { PROMPTS, nextPromptIndex, reportPromptShown } from '@/lib/client/prompts'
import { computeStreak } from '@/lib/client/streak'
import { clearLocalDraft, fetchServerDraft, loadLocalDraft, pickNewer, pushServerDraft, saveLocalDraft } from '@/lib/client/draft-sync'
import { BRAND_GRADIENT_CLASS, PRIMARY_BUTTON_CLASS } from '@/lib/client/ui'
import { cacheOnThisDay, cacheStats, enqueueOfflineEntry, flushOfflineQueue, getCachedOnThisDay, getCachedStats } from '@/lib/client/offline'
import { isOfflineCacheEnabled } from '@/lib/client/prefs'

export default function DiaryEditor() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [savedTime, setSavedTime] = useState('')
  // 离线保存标记：saved 态下区分「已落库」与「已入离线队列待同步」的文案
  const [savedOffline, setSavedOffline] = useState(false)
  const [showConfetti, setShowConfetti] = useState(false)
  const [showDraftBanner, setShowDraftBanner] = useState(false)
  const [streak, setStreak] = useState(0)
  const [entryCount, setEntryCount] = useState<number | null>(null) // 总篇数（首进入引导用）
  // 去年的今天：往年同月日随机一篇（解密后显示标题/预览）
  const [onThisDay, setOnThisDay] = useState<{ id: string; ciphertext: string; iv: string; createdAt: string } | null>(null)
  const [onThisDayPreview, setOnThisDayPreview] = useState('')
  // 今天是否已隐藏去年今日（localStorage 按日期键控：qo-otd-hidden-YYYY-MM-DD = '1'。
  // 按日期而非条目 id 隐藏——on-this-day 随机取篇，按 id 隐藏切回后可能随机到另一条重新显示）
  const [otdHidden, setOtdHidden] = useState(false)
  // 每日提示：索引初始 0（确定值，SSR/客户端一致），mount 后随机；行始终存在（占位，不跳动）
  const [promptIdx, setPromptIdx] = useState<number>(0)
  const textRef = useRef('')
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingDraftRef = useRef<{ ciphertext: string; iv: string } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 草稿写回 epoch：save/discard 成功时递增，作废进行中的冲刷（防止"放弃/保存后草稿复活"的竞态）
  const draftEpochRef = useRef(0)

  // 草稿冲刷（防抖回调/卸载/pagehide/online 共用）：
  // 加密存 IndexedDB（本地优先），随后尽力同步服务器；成功后回写服务器时间戳收敛两端时钟
  // （冲突决策用本地时钟比较，收敛后两边同钟，避免下次加载误判）。
  const flushDraft = useCallback(async (text: string): Promise<void> => {
    const epoch = draftEpochRef.current
    try {
      const dek = getDek()
      if (!dek || !text.trim()) return
      const { ciphertext, iv } = await encryptText(dek, text)
      if (epoch !== draftEpochRef.current) return // 保存/放弃已发生，不再写回草稿
      const record = { ciphertext, iv, encryptionVersion: 1, updatedAt: Date.now() }
      await saveLocalDraft(record) // 本地优先（离线可用）
      // 发出前再查 epoch：保存/放弃已发生时不再推服务器（防止"放弃/保存后草稿复活"竞态）
      if (epoch !== draftEpochRef.current) return
      const server = await pushServerDraft(record).catch(() => null) // 服务器同步尽力而为（离线静默失败，下次输入/页面加载重试）
      if (server && epoch === draftEpochRef.current) {
        // 收敛时钟：以服务器时间戳为准回写本地草稿记录
        await saveLocalDraft({ ...record, updatedAt: new Date(server.updatedAt).getTime() })
      }
    } catch { /* 草稿保存失败不阻塞输入 */ }
  }, [])

  // 键盘遮挡与高度适配已由 AutoTextarea 统一处理（visualViewport resize → fitHeight）

  // 卸载/pagehide 冲刷未决草稿（避免丢末段输入，iOS Safari pagehide 更可靠）；online 恢复时补推
  useEffect(() => {
    const flushNow = () => {
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
      const current = textRef.current
      if (current.trim()) void flushDraft(current) // fire-and-forget，静默失败
    }
    const onPageHide = () => flushNow()
    const onOnline = () => {
      const current = textRef.current
      if (current.trim()) void flushDraft(current)
    }
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('online', onOnline)
      flushNow() // 卸载前冲刷
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current)
    }
  }, [flushDraft])

  // 页面加载时检查本地/服务器草稿，有未完成草稿则显示恢复横幅
  useEffect(() => {
    void (async () => {
      try {
        const dek = getDek()
        if (!dek) return
        const local = await loadLocalDraft()
        const server = await fetchServerDraft()
        // 冲突决策：本地更空或服务器更新则用服务器；否则用本地
        let best: { ciphertext: string; iv: string } | null = null
        let useLocal = false
        if (local) {
          let localText = ''
          try { localText = await decryptText(dek, local.ciphertext, local.iv) } catch { /* 损坏草稿忽略 */ }
          const decision = pickNewer({ updatedAt: local.updatedAt, text: localText }, server ? { updatedAt: new Date(server.updatedAt).getTime() } : null)
          if (decision && decision.text.trim() !== '') {
            best = { ciphertext: local.ciphertext, iv: local.iv }
            useLocal = true
          }
        }
        if (server && !best) {
          // 本地无草稿或本地更空 → 用服务器草稿（若服务器内容非空）
          best = { ciphertext: server.ciphertext, iv: server.iv }
        }
        if (best) {
          // 加载竞态：用户已开始输入则不弹横幅（输入内容会走防抖保存）
          if (textRef.current === '') {
            pendingDraftRef.current = best
            setShowDraftBanner(true)
          }
          // 收敛：本地胜出（或服务器为空但本地非空）→ 推送服务器，成功后回写服务器时间戳（两端同钟）
          if (useLocal && local) {
            void (async () => {
              const serverUpd = await pushServerDraft(local).catch(() => null)
              if (serverUpd) await saveLocalDraft({ ...local, updatedAt: new Date(serverUpd.updatedAt).getTime() })
            })()
          }
        }
      } catch { /* 草稿加载失败不阻塞编辑 */ }
    })()
  }, [])

  // 去年今日隐藏状态：今天是否已隐藏（同步快，先于异步 fetch 完成）。
  // localStorage 只在客户端可读，只能在挂载后 setState 一次——这是该场景的标准做法
  // （放渲染期会破坏 SSR hydration），react-hooks/set-state-in-effect 在此为误报。
  useEffect(() => {
    const d = new Date()
    const key = `qo-otd-hidden-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 客户端专属来源，挂载后同步一次
      setOtdHidden(localStorage.getItem(key) === '1')
    } catch { /* 忽略 */ }
  }, [])

  // 每日提示：初始随机一条；每次显示（含切换）上报出现次数。
  // nextPromptIndex() 不是纯函数（会更新提示出现统计），不能在渲染期调用，
  // 只能在挂载后初始化一次——规则在此为误报。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 带副作用的客户端专属初始化
    setPromptIdx(nextPromptIndex())
  }, [])
  useEffect(() => {
    reportPromptShown(promptIdx)
  }, [promptIdx])

  // 连续写作天数 + 总篇数 + 去年的今天（并行获取；失败静默）。
  // 离线兜底：请求不可达时回退缓存（统计/去年今日各一份密文缓存；OTD 只回放当天的）。
  useEffect(() => {
    void (async () => {
      try {
        const [statsRes, otdRes] = await Promise.all([
          fetch('/api/diary/stats').then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch('/api/diary/on-this-day').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ])
        const stats = (statsRes as { count: number; byDay: Record<string, { count: number; words: number }> } | null)
          ?? (await getCachedStats())
        if (stats) {
          if (statsRes) void cacheStats(statsRes)
          setEntryCount(stats.count)
          setStreak(computeStreak(stats.byDay ?? {}, new Date()))
        }
        let otdEntry: { id: string; ciphertext: string; iv: string; createdAt: string } | null = null
        if (otdRes?.entry) {
          otdEntry = otdRes.entry
          void cacheOnThisDay(otdRes.entry)
        } else if (!otdRes) {
          otdEntry = await getCachedOnThisDay()
        }
        if (otdEntry) {
          setOnThisDay(otdEntry)
          // 解密预览（首行标题）
          const dek = getDek()
          if (dek) {
            try {
              const plain = await decryptText(dek, otdEntry.ciphertext, otdEntry.iv)
              setOnThisDayPreview(plain.split('\n').find((l) => l.trim()) ?? '')
            } catch { /* 解密失败：卡片只显示日期 */ }
          }
        }
      } catch { /* 静默 */ }
    })()
  }, [])

  // 进入写页即尝试冲刷离线写队列（上次离线保存的日记，联网后自动补传）
  useEffect(() => { void flushOfflineQueue() }, [])

  // 防抖保存：输入 1000ms 后冲刷草稿（本地 IndexedDB 优先，服务器同步尽力而为）
  function onDraftChange(text: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      void flushDraft(text)
    }, 1000)
  }

  // 恢复草稿：解密后填入编辑器
  async function restoreDraft() {
    const dek = getDek()
    const pending = pendingDraftRef.current
    if (!dek || !pending) return
    try {
      const plain = await decryptText(dek, pending.ciphertext, pending.iv)
      setText(plain); textRef.current = plain
      setShowDraftBanner(false); pendingDraftRef.current = null
    } catch {
      setShowDraftBanner(false) // 损坏草稿：放弃并提示
    }
  }

  // 放弃草稿：清本地 IndexedDB 与服务器，并作废进行中的草稿写回
  async function discardDraft() {
    pendingDraftRef.current = null
    setShowDraftBanner(false)
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
    draftEpochRef.current++ // 放弃后不再写回草稿
    await clearLocalDraft()
    await fetch('/api/draft', { method: 'DELETE' }).catch(() => {})
  }

  // 保存后异步补写定位与元数据：绝不阻塞保存反馈。
  // 定位单独给足超时——原先保存路径用的是 getPosition(2000)，2 秒对 iOS 冷启动
  // 首次高精度定位（常需 5~15s）远远不够，且系统权限弹窗的等待时间也计入超时，
  // 超时后静默返回 null，这就是「有些笔记没有地点」的根因。
  // 现在保存先落库，定位在后台从容获取后再 PATCH 补写。
  async function backfillLocation(entryId: string) {
    if (!isLocationEnabled()) return
    try {
      const loc = await getPosition(15_000)
      if (loc?.latitude == null || loc.longitude == null) return
      const { latitude, longitude } = loc
      const patch: Record<string, unknown> = {
        latitude, longitude, locationAccuracy: loc.accuracy,
      }
      // 地点名反查与实时天气并行 → 一次 PATCH。
      // 反查发送的是模糊后坐标（见 geocode.ts 的 coarsenCoordinate），精确坐标不出设备。
      const [name, weather] = await Promise.all([
        isAutoPlaceNameEnabled() ? clientReverseGeocode(latitude, longitude) : Promise.resolve(null),
        isWeatherEnabled() ? fetchWeather(latitude, longitude) : Promise.resolve(null),
      ])
      if (name) patch.locationName = name
      if (weather) patch.weather = weather
      await fetch(`/api/diary/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
    } catch { /* 补写失败静默：详情页仍显示正文，可点坐标手动补查地点 */ }
  }

  async function save() {
    const dek = getDek()
    const body = textRef.current.trim()
    if (!dek || !body) { setStatus('idle'); return }
    setStatus('saving')
    try {
      const { ciphertext, iv } = await encryptText(dek, body)
      const res = await fetch('/api/diary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ciphertext, iv, encryptionVersion: 1,
          wordCount: body.length, // 解密时计算（与编辑器底部字数一致：trim 后长度）
          // 坐标一律先留空：定位在保存成功后异步补写（见 backfillLocation），
          // 避免 2 秒超时把位置直接丢掉，也避免保存按钮长时间转圈
          latitude: null,
          longitude: null,
          locationAccuracy: null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      }).catch(() => null)
      // 离线（请求不可达）：入本地队列待同步，体验等同保存成功（联网后自动补传）。
      // 队列项带客户端 UUID——重传走服务端幂等插入，不会重复入库。
      if (res === null) {
        if (!isOfflineCacheEnabled()) throw new Error('save failed')
        await enqueueOfflineEntry({
          id: crypto.randomUUID(),
          ciphertext, iv,
          wordCount: body.length,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          queuedAt: Date.now(),
        })
        if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
        draftEpochRef.current++
        await clearLocalDraft()
        const now = new Date()
        setSavedTime(now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }))
        setSavedOffline(true)
        setStatus('saved')
        playSaveSound()
        setShowConfetti(true)
        setText(''); textRef.current = ''
        if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current)
        statusTimeoutRef.current = setTimeout(() => { setStatus('idle'); setSavedOffline(false) }, 2600)
        return
      }
      if (!res.ok) throw new Error('save failed')
      // POST 响应结构是 { entry }，这里是补写定位所必需的 entry.id
      const { entry: savedEntry } = await res.json() as { entry?: { id?: string } }
      // 保存成功：取消未决防抖并作废进行中的冲刷，防止草稿"复活"
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
      draftEpochRef.current++
      await fetch('/api/draft', { method: 'DELETE' }).catch(() => {})
      await clearLocalDraft()
      const now = new Date()
      setSavedTime(now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }))
      setSavedOffline(false) // 在线路径必重置（前一次离线保存的标记可能尚未超时清除）
      setStatus('saved')
      playSaveSound() // 清脆保存音效（Web Audio 合成）
      setShowConfetti(true) // 游戏获奖式庆祝反馈
      setText(''); textRef.current = ''
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current)
      statusTimeoutRef.current = setTimeout(() => { setStatus('idle'); setShowConfetti(false) }, 2000)
      // 定位与元数据异步补写：此刻保存反馈已经完成，用户可立即继续操作
      if (savedEntry?.id) void backfillLocation(savedEntry.id)
    } catch {
      setStatus('error')
    }
  }

  const today = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })

  return (
    // 弹性高度（body flex 布局中自动分配视口减页脚后的空间）+ 禁止滚动：
    // header/输入区/footer 全部在可视区内，输入区 flex 弹性分配剩余空间；页脚在流内不遮挡
    <div className="animate-fade-in mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col overflow-hidden px-5 safe-pt">
      {/* viewTransitionName：页面切换动画中页头保持固定（空间锚点） */}
      <header className="py-4">
        {/* 页头不再放「全部日记」「设置」图标——这两个目的地已由底部 TabBar 承担，
            同一入口出现两处只会让页头变杂（也符合 iOS 习惯：顶部不放重复的 tab 入口） */}
        <OrbitLogo />
        <div className="mt-1 flex items-center justify-between text-sm text-neutral-400">
          <span className="bg-linear-to-r from-orange-500 via-rose-400 to-violet-500 bg-clip-text font-medium text-transparent">
            {today}
          </span>
          {/* 连续写作天数（设置页可关；今天未写但昨天有记录不中断）。
              invisible 占位：stats 拉取前后该元素始终存在，避免内容出现引起行跳动 */}
          <span className={`text-xs ${streak > 0 && isStreakEnabled() ? '' : 'invisible'}`}>
            🔥 连续写了 {Math.max(streak, 1)} 天
          </span>
        </div>
      </header>
      {/* 去年的今天：往年同月日的随机一篇，点击查看详情；右侧 ✕ 隐藏（今天不再显示） */}
      {isOnThisDayEnabled() && !otdHidden && onThisDay && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-neutral-100 bg-neutral-50/60 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/40">
          <Link href={`/entry/${onThisDay.id}`} className="min-w-0 flex-1 active:opacity-60">
            <p className="text-xs font-medium text-neutral-400">
              去年的今天 · {new Date(onThisDay.createdAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
            </p>
            {onThisDayPreview && (
              <p className="mt-1 line-clamp-1 text-sm text-neutral-700 dark:text-neutral-300">{onThisDayPreview}</p>
            )}
          </Link>
          <button
            onClick={() => {
              setOtdHidden(true)
              const d = new Date()
              const key = `qo-otd-hidden-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
              try { localStorage.setItem(key, '1') } catch { /* 忽略 */ }
            }}
            aria-label="隐藏"
            className="shrink-0 px-0.5 text-sm leading-5 text-neutral-300 active:opacity-60 dark:text-neutral-600"
          >
            ✕
          </button>
        </div>
      )}
      {showDraftBanner && (
        /* 未完成草稿横幅：单行紧凑结构——此前是「标题 + 两个下划线文字链」两层，
           文案与元素都偏多；且 amber 是全站唯一的黄系，与「品牌渐变 + 中性灰」体系不搭。
           现在配色对齐同页的「去年的今天」卡片（中性灰底 + 1px 边框），主操作借用主按钮的
           品牌渐变；文案压到最短（“恢复 / 放弃”已由行内文案交代对象）。
           交互完全不变：恢复 = 解密填入编辑器；放弃 = 清本地 IndexedDB + 服务器草稿。 */
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-neutral-100 bg-neutral-50/60 px-3.5 py-2 dark:border-neutral-800 dark:bg-neutral-900/40">
          <p className="min-w-0 flex-1 text-xs text-neutral-500 dark:text-neutral-400">发现未完成的草稿</p>
          <button
            onClick={() => void restoreDraft()}
            className="shrink-0 rounded-lg bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-3 py-1.5 text-xs font-medium text-white active:opacity-90"
          >
            恢复
          </button>
          <button
            onClick={() => void discardDraft()}
            className="shrink-0 py-1.5 text-xs text-neutral-400 active:opacity-60"
          >
            放弃
          </button>
        </div>
      )}
      {/* 每日提示：随机一句，点击换一条（写作灵感） */}
      {isPromptEnabled() && (
        <button
          onClick={() => setPromptIdx(nextPromptIndex(promptIdx))}
          className="mb-2 flex items-start gap-1.5 text-left text-xs leading-relaxed text-neutral-400/70 active:opacity-60"
        >
          <span className="shrink-0">💭</span>
          <span>{PROMPTS[promptIdx]}</span>
        </button>
      )}
      <AutoTextarea
        value={text}
        onChange={(v) => { setText(v); textRef.current = v; onDraftChange(v) }}
        placeholder={entryCount === 0 ? '写下第一篇日记吧' : '在此处输入内容...'}
        autoFocus
        disabled={status === 'saving'}
      />
      {/* 空状态引导：首次（无任何日记）时显示柔和渐变引导 */}
      {entryCount === 0 && (
        <div className="flex flex-col items-center gap-2 py-5">
          <span className="text-2xl">🌱</span>
          <p className="bg-linear-to-r from-orange-500 via-rose-400 to-violet-500 bg-clip-text text-sm font-medium text-transparent">
            写下第一篇日记，开始属于你的 Orbit
          </p>
        </div>
      )}
      {showConfetti && <ConfettiBurst />}
      {/* 左右不再单独留白：原先这里是 px-2，而输入框（AutoTextarea）没有左右内边距，
          于是「保存」按钮比它上方的输入框窄了 8px，也不比详情页编辑态的「保存修改」
          （底部区无 px，直接吃 main 的 px-5）。去掉后两页主按钮左右边界一致。
          上 8px / 下 16px：下边距与详情页编辑态底部区、查看态操作栏对齐（TabBar 就在紧下方）。
          底部安全区不再由这里承担——(app)/layout 的 TabBar 已经自带 pb-safe，
          此处若再加 env(safe-area-inset-bottom) 会叠出一段空白。
          也不能用 safe-pb + pb-4 组合——.safe-pb 是 unlayered 自定义类，会覆盖 Tailwind 的 pb-4 */}
      <footer className="mt-auto pb-4 pt-2">
        <p className="mb-3 text-center text-xs text-neutral-400">
          {status === 'saving' && '正在保存…'}
          {status === 'saved' && (
            <span className="animate-pop inline-block text-sm font-semibold text-emerald-500">
              {savedOffline ? `✓ 已离线保存 · 联网后自动同步` : `✓ 已保存 · ${savedTime}`}
            </span>
          )}
          {status === 'error' && '保存失败，请重试'}
          {status === 'idle' && text.trim().length > 0 && `共 ${text.trim().length} 字`}
        </p>
        <button
          onClick={() => void save()}
          disabled={!text.trim() || status === 'saving'}
          /* 样式取全宽主按钮常量（与详情页编辑态「保存修改」逐字符同一份，含 py-4 高度与
             disabled:opacity-50）；唯一分支是 saved 态换成翠绿底表示「已落盘」。 */
          className={`${PRIMARY_BUTTON_CLASS} ${
            status === 'saved' ? 'bg-emerald-500 dark:bg-emerald-500' : BRAND_GRADIENT_CLASS
          }`}
        >
          {status === 'saving' ? '保存中…' : status === 'saved' ? '已保存 ✓' : '保存'}
        </button>
      </footer>
    </div>
  )
}
