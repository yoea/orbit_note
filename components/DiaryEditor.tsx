'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import AutoTextarea from './AutoTextarea'
import ConfettiBurst from './ConfettiBurst'
import OrbitLogo from './OrbitLogo'
import { getDek } from '@/lib/client/session'
import { decryptText, encryptText } from '@/lib/client/crypto/encryption'
import { getPosition } from '@/lib/client/location'
import { isLocationEnabled, isPromptEnabled, isStreakEnabled, isWeatherEnabled } from '@/lib/client/prefs'
import { clientReverseGeocode } from '@/lib/client/geocode'
import { fetchWeather } from '@/lib/client/weather'
import { playSaveSound } from '@/lib/client/sound'
import { PROMPTS, randomPromptIndex, reportPromptShown } from '@/lib/client/prompts'
import { computeStreak } from '@/lib/client/streak'
import { clearLocalDraft, fetchServerDraft, loadLocalDraft, pickNewer, pushServerDraft, saveLocalDraft } from '@/lib/client/draft-sync'

export default function DiaryEditor() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [savedTime, setSavedTime] = useState('')
  const [showConfetti, setShowConfetti] = useState(false)
  const [showDraftBanner, setShowDraftBanner] = useState(false)
  const [streak, setStreak] = useState(0)
  const [entryCount, setEntryCount] = useState<number | null>(null) // 总篇数（首进入引导用）
  // 去年的今天：往年同月日随机一篇（解密后显示标题/预览）
  const [onThisDay, setOnThisDay] = useState<{ id: string; ciphertext: string; iv: string; createdAt: string } | null>(null)
  const [onThisDayPreview, setOnThisDayPreview] = useState('')
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

  // 每日提示：初始随机一条；每次显示（含切换）上报出现次数
  useEffect(() => {
    setPromptIdx(randomPromptIndex())
  }, [])
  useEffect(() => {
    reportPromptShown(promptIdx)
  }, [promptIdx])

  // 连续写作天数 + 总篇数 + 去年的今天（并行获取；失败静默）
  useEffect(() => {
    void (async () => {
      try {
        const [statsRes, otdRes] = await Promise.all([
          fetch('/api/diary/stats'),
          fetch('/api/diary/on-this-day'),
        ])
        if (statsRes.ok) {
          const data = await statsRes.json() as { count: number; byDay: Record<string, { count: number; words: number }> }
          setEntryCount(data.count)
          setStreak(computeStreak(data.byDay ?? {}, new Date()))
        }
        if (otdRes.ok) {
          const data = await otdRes.json() as { entry: { id: string; ciphertext: string; iv: string; createdAt: string } | null }
          if (data.entry) {
            setOnThisDay(data.entry)
            // 解密预览（首行标题）
            const dek = getDek()
            if (dek) {
              try {
                const plain = await decryptText(dek, data.entry.ciphertext, data.entry.iv)
                setOnThisDayPreview(plain.split('\n').find((l) => l.trim()) ?? '')
              } catch { /* 解密失败：卡片只显示日期 */ }
            }
          }
        }
      } catch { /* 静默 */ }
    })()
  }, [])

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

  async function save() {
    const dek = getDek()
    const body = textRef.current.trim()
    if (!dek || !body) { setStatus('idle'); return }
    setStatus('saving')
    try {
      // 定位开关（默认开启）：关闭后不请求定位
      const loc = isLocationEnabled() ? await getPosition(2000) : null
      const { ciphertext, iv } = await encryptText(dek, body)
      const res = await fetch('/api/diary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ciphertext, iv, encryptionVersion: 1,
          wordCount: body.length, // 解密时计算（与编辑器底部字数一致：trim 后长度）
          latitude: loc?.latitude ?? null,
          longitude: loc?.longitude ?? null,
          locationAccuracy: loc?.accuracy ?? null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      })
      if (!res.ok) throw new Error('save failed')
      // 保存成功后异步补写元数据（不阻塞保存反馈）：地点名反查 + 实时天气并行 → 一次 PATCH。
      // 注意：POST 响应结构是 { entry }，必须解构 entry.id（此前误解构为 { id } 导致 PATCH 从未执行）
      // 失败静默——详情页仍显示坐标，点击坐标可再次查询地点
      if (loc?.latitude != null && loc.longitude != null) {
        const { entry: savedEntry } = await res.json() as { entry?: { id?: string } }
        void (async () => {
          try {
            const [name, weather] = await Promise.all([
              clientReverseGeocode(loc.latitude!, loc.longitude!),
              isWeatherEnabled() ? fetchWeather(loc.latitude!, loc.longitude!) : Promise.resolve(null),
            ])
            const patch: Record<string, unknown> = {}
            if (name) patch.locationName = name
            if (weather) patch.weather = weather
            if (savedEntry?.id && Object.keys(patch).length > 0) {
              await fetch(`/api/diary/${savedEntry.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
              })
            }
          } catch { /* 元数据补写失败静默 */ }
        })()
      }
      // 保存成功：取消未决防抖并作废进行中的冲刷，防止草稿"复活"
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
      draftEpochRef.current++
      await fetch('/api/draft', { method: 'DELETE' }).catch(() => {})
      await clearLocalDraft()
      const now = new Date()
      setSavedTime(now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }))
      setStatus('saved')
      playSaveSound() // 清脆保存音效（Web Audio 合成）
      setShowConfetti(true) // 游戏获奖式庆祝反馈
      setText(''); textRef.current = ''
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current)
      statusTimeoutRef.current = setTimeout(() => { setStatus('idle'); setShowConfetti(false) }, 2000)
    } catch {
      setStatus('error')
    }
  }

  const today = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })

  return (
    // 弹性高度（body flex 布局中自动分配视口减页脚后的空间）+ 禁止滚动：
    // header/输入区/footer 全部在可视区内，输入区 flex 弹性分配剩余空间；页脚在流内不遮挡
    <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col overflow-hidden px-5 safe-pt">
      {/* viewTransitionName：页面切换动画中页头保持固定（空间锚点） */}
      <header className="py-4">
        <div className="flex items-center justify-between">
          <OrbitLogo />
          <nav className="flex items-center gap-4">
            {/* 原生路由导航（DEK 会话级持久化——重载后自动恢复，无需重复 Face ID；右滑返回原生可用）；
                transitionTypes：前进方向滑动动画 */}
            <Link href="/history" className="text-sm text-neutral-400">历史</Link>
            <Link href="/settings" className="text-sm text-neutral-400">设置</Link>
          </nav>
        </div>
        <div className="mt-1 flex items-center justify-between text-sm text-neutral-400">
          <span>{today}</span>
          {/* 连续写作天数（设置页可关；今天未写但昨天有记录不中断）。
              invisible 占位：stats 拉取前后该元素始终存在，避免内容出现引起行跳动 */}
          <span className={`text-xs ${streak > 0 && isStreakEnabled() ? '' : 'invisible'}`}>
            🔥 连续写了 {Math.max(streak, 1)} 天
          </span>
        </div>
      </header>
      {/* 去年的今天：往年同月日的随机一篇，点击查看详情 */}
      {onThisDay && (
        <Link
          href={`/entry/${onThisDay.id}`}
          className="mb-3 block rounded-xl border border-neutral-100 bg-neutral-50/60 px-4 py-3 active:opacity-60 dark:border-neutral-800 dark:bg-neutral-900/40"
        >
          <p className="text-xs font-medium text-neutral-400">
            去年的今天 · {new Date(onThisDay.createdAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
          </p>
          {onThisDayPreview && (
            <p className="mt-1 line-clamp-1 text-sm text-neutral-700 dark:text-neutral-300">{onThisDayPreview}</p>
          )}
        </Link>
      )}
      {showDraftBanner && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">发现上次未完成的日记</p>
          <div className="mt-2 flex gap-3">
            <button onClick={() => void restoreDraft()} className="text-sm font-medium text-amber-800 underline dark:text-amber-200">恢复草稿</button>
            <button onClick={() => void discardDraft()} className="text-sm text-amber-700 dark:text-amber-300">放弃草稿</button>
          </div>
        </div>
      )}
      {/* 每日提示：随机一句，点击换一条（写作灵感） */}
      {isPromptEnabled() && (
        <button
          onClick={() => setPromptIdx(randomPromptIndex(promptIdx))}
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
      {showConfetti && <ConfettiBurst />}
      {/* 上下 padding 均 8px（桌面端）；iPhone 底部取安全区。
          不能用 safe-pb + pb-2 组合——.safe-pb 是 unlayered 自定义类，会覆盖 Tailwind 的 pb-2 */}
      <footer className="mt-auto px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2">
        <p className="mb-3 text-center text-xs text-neutral-400">
          {status === 'saving' && '正在保存…'}
          {status === 'saved' && (
            <span className="animate-pop inline-block text-sm font-semibold text-emerald-500">✓ 已保存 · {savedTime}</span>
          )}
          {status === 'error' && '保存失败，请重试'}
          {status === 'idle' && text.trim().length > 0 && `共 ${text.trim().length} 字`}
        </p>
        <button
          onClick={() => void save()}
          disabled={!text.trim() || status === 'saving'}
          className={`w-full rounded-2xl py-3.5 font-medium text-white transition-colors active:scale-[0.99] disabled:opacity-30 ${
            status === 'saved' ? 'bg-emerald-500 dark:bg-emerald-500' : 'bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 text-white'
          }`}
        >
          {status === 'saving' ? '保存中…' : status === 'saved' ? '已保存 ✓' : '保存'}
        </button>
      </footer>
    </div>
  )
}
