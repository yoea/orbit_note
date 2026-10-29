'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import AutoTextarea from './AutoTextarea'
import ConfettiBurst from './ConfettiBurst'
import OrbitLogo from './OrbitLogo'
import Markdown from './Markdown'
import MarkdownToolbar from './MarkdownToolbar'
import { countWords, deriveTitlePreview, toPlainText } from '@/lib/client/markdown'
import { useMarkdownEditor } from '@/lib/client/use-markdown-editor'
import { getDek } from '@/lib/client/session'
import { decryptText, encryptText } from '@/lib/client/crypto/encryption'
import { getPosition } from '@/lib/client/location'
import { isAutoPlaceNameEnabled, isLocationEnabled, isOfflineCacheEnabled, isOnThisDayEnabled, isPromptEnabled, isStreakEnabled, isWeatherEnabled } from '@/lib/client/prefs'
import { clientReverseGeocode } from '@/lib/client/geocode'
import { locationPatch } from '@/lib/client/location'
import { fetchWeather } from '@/lib/client/weather'
import { playSaveSoundIfEnabled } from '@/lib/client/sound'
import { PROMPTS, nextPromptIndex, reportPromptShown } from '@/lib/client/prompts'
import { computeStreak } from '@/lib/client/streak'
import { clearLocalDraft, fetchServerDraft, loadLocalDraft, pickNewer, pushServerDraft, saveLocalDraft } from '@/lib/client/draft-sync'
import { BRAND_GRADIENT_CLASS, PRIMARY_BUTTON_CLASS } from '@/lib/client/ui'
import { cacheOnThisDay, cacheStats, enqueueOfflineEntry, flushOfflineQueue, getCachedOnThisDay, getCachedStats } from '@/lib/client/offline'

// 跨 tab 切换保留「正在编辑的正文」（模块级内存快照）。
//
// 为什么需要它：底部三个 tab 页在 App Router 里是**互斥挂载**的 —— 切走即卸载组件，
// 组件内的 `text` 随之丢失。回来时重挂载，挂载 effect 从 IndexedDB/服务器读到刚冲刷的草稿，
// 于是弹出「有草稿是否恢复」横幅。用户看到的却是「输入框被清空 + 还得手动点恢复」。
// ★ 草稿机制（IndexedDB + 服务器同步）的定位是**「关页面 / 崩溃 / 换设备」的兜底**，
//   不该拿来兜一次 tab 切换 —— 那是两件不同的事。
// 做法与列表页 `DiaryListView` 的 `snapshot` 同款：模块级变量只活在**当前页面会话**里，
// 刷新/重开即失效 —— 那时仍由草稿横幅兜底，那条路径原样不变。
let editorSnapshot = ''

export default function DiaryEditor() {
  const [text, setText] = useState(() => editorSnapshot)
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
  // 每日提示是否显示：只受偏好开关控制（2026-10-01 时机档已删，回归纯开关）。
  // ★ 必须在下面的上报 effect 之前声明（effect 依赖它决定「是否真的显示了」）。
  const isPromptVisible = isPromptEnabled()
  const textRef = useRef(editorSnapshot)
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingDraftRef = useRef<{ ciphertext: string; iv: string } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 草稿写回 epoch：save/discard 成功时递增，作废进行中的冲刷（防止"放弃/保存后草稿复活"的竞态）
  const draftEpochRef = useRef(0)
  // 本次挂载内用户是否**真的改过正文**（只有 onDraftChange 会置位 —— 那是用户的编辑入口）。
  // 用途：卸载/pagehide 时决定要不要碰草稿。★ 没有它会有一个反向 bug：
  // 用户打开写页 → 顶上弹着「有草稿是否恢复」还没决策 → 直接切走 ⇒ 那次卸载会把草稿删掉。
  const userEditedRef = useRef(false)

  // 正文变化 → 同步模块级快照（切 tab 卸载后回来靠它还原，见 editorSnapshot 的注释）。
  // ★ 放在 effect 里而不是各 setText 调用点：保存成功、离线保存、恢复草稿都会改 text，
  //   一处覆盖不会漏；卸载时最后一次 effect 也已跑过，快照必然是最新值。
  useEffect(() => { editorSnapshot = text }, [text])

  // Markdown 工具条 + 预览切换的接线（选区还原、预览滚动定位都在 hook 内；
  // 横条本身见 components/MarkdownToolbar.tsx，与详情页编辑态共用同一份）。
  const { editorRef, previewRef, preview, togglePreview, applyToolbar } = useMarkdownEditor({
    text,
    // 工具条改正文的唯一出口：state / textRef / 草稿三处必须同步
    applyText: (v) => { setText(v); textRef.current = v; onDraftChange(v) },
  })

  // 草稿冲刷（防抖回调/卸载/pagehide/online 共用）：
  // 加密存 IndexedDB（本地优先），随后尽力同步服务器；成功后回写服务器时间戳收敛两端时钟
  // （冲突决策用本地时钟比较，收敛后两边同钟，避免下次加载误判）。
  const flushDraft = useCallback(async (text: string): Promise<void> => {
    const epoch = draftEpochRef.current
    try {
      const dek = getDek()
      // 空文本在这里直接返回是**刻意**的：本函数只负责「写草稿」，绝不写空草稿。
      // ★ 「正文被清空 ⇒ 把已存的草稿清掉」是 syncDraft 的职责（它把空文本路由到
      //   clearStoredDraft）。这两件事必须分开 —— 2026-10-09 的 bug 就是把「不写空的」
      //   当成了「不用管」，于是旧草稿永远留在库里。
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

  // 清掉「已存下的草稿」（本地 IndexedDB + 服务器），并作废进行中的冲刷。
  // 两个调用方，语义是同一条规则的两面：
  //   · 用户点横幅上的「放弃」；
  //   · 正文被清空 —— 已经没有可恢复的东西了，旧草稿必须一起消失。
  // ★ 必须**同时**清本地与服务器：下次挂载时服务器草稿是独立的一条来源
  //   （`if (server && !best)` 那支会把它当成更新的草稿重新弹出来），只清本地照样复活。
  const clearStoredDraft = useCallback(async (): Promise<void> => {
    pendingDraftRef.current = null
    setShowDraftBanner(false)
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
    draftEpochRef.current++ // 作废进行中的冲刷，防止刚删掉的草稿被写回来
    await clearLocalDraft()
    await fetch('/api/draft', { method: 'DELETE' }).catch(() => {})
  }, [])

  // 把「当前正文」同步成草稿。★ 空文本是**清草稿**，不是「什么都不做」——
  // 2026-10-09 修的 bug：输入「你好啊」→ 存成草稿 → 全删 → 切 tab 再回来，
  // 仍弹「有草稿是否恢复」、恢复出来还是「你好啊」。根因就是当时的三个入口
  // （flushDraft 内部的 `!text.trim()` 早退、卸载/pagehide 的 `if (current.trim())`）
  // 在正文为空时**全部直接跳过** ⇒ 库里那条旧草稿永远不会被清掉。
  const syncDraft = useCallback(async (text: string): Promise<void> => {
    if (!text.trim()) await clearStoredDraft()
    else await flushDraft(text)
  }, [flushDraft, clearStoredDraft])

  // 键盘弹出时**不再**压整页高度：正文编辑区自己是滚动容器，光标在它内部被算成可见，
  // iOS 就不会去滚可视视口。这段能力（use-viewport-height.ts）2026-10-06 曾用于压整页，
  // 但它正是「保存按钮下方一大片空白」的成因（详见 render 里 header 之后的注释块）。
  // hook 本身保留给详情页编辑态使用（那边的结构不同）。

  // 卸载/pagehide 冲刷未决草稿（避免丢末段输入，iOS Safari pagehide 更可靠）；online 恢复时补推
  useEffect(() => {
    const flushNow = () => {
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
      // ★ 用户这次没动过正文 ⇒ 什么都不做。否则「打开写页、顶上还弹着『有草稿是否恢复』
      //   没做决策、直接切走」会在这里把草稿删掉 —— 那是另一个方向的 bug。
      if (!userEditedRef.current) return
      // ★ 空正文也要走这一趟（走的是 syncDraft 的清理分支）：用户在输入框里全删之后
      //   直接切 tab，旧草稿不能留在库里，否则切回来又弹恢复、恢复出来还是删掉前的内容。
      void syncDraft(textRef.current) // fire-and-forget，静默失败
    }
    const onPageHide = () => flushNow()
    // online：把之前推失败的草稿补推（没改过就没有待推的东西）
    const onOnline = () => { if (userEditedRef.current) void syncDraft(textRef.current) }
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('online', onOnline)
      flushNow() // 卸载前冲刷
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current)
    }
  }, [syncDraft])

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

  // 每日提示：初始随机一条；每次「真的显示出来」才上报出现次数。
  // nextPromptIndex() 不是纯函数（会更新提示出现统计），不能在渲染期调用，
  // 只能在挂载后初始化一次——规则在此为误报。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 带副作用的客户端专属初始化
    setPromptIdx(nextPromptIndex())
  }, [])
  // ★ 上报时机必须与「提示是否真的渲染」对齐：
  // 若照旧按 promptIdx 变化就上报，偏好关闭时会出现「提示没显示但出现次数 +1」的
  // 失真。因此把 isPromptVisible 一并纳入依赖，只有可见时才上报。
  useEffect(() => {
    if (isPromptVisible) reportPromptShown(promptIdx)
  }, [promptIdx, isPromptVisible])

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
          // 解密预览（首行标题）。走纯文本派生，否则卡片上会显示 `# ` 与 `**`。
          const dek = getDek()
          if (dek) {
            try {
              const plain = await decryptText(dek, otdEntry.ciphertext, otdEntry.iv)
              const { title } = deriveTitlePreview(toPlainText(plain))
              setOnThisDayPreview(title)
            } catch { /* 解密失败：卡片只显示日期 */ }
          }
        }
      } catch { /* 静默 */ }
    })()
  }, [])

  // 进入写页即尝试冲刷离线写队列（上次离线保存的日记，联网后自动补传）
  useEffect(() => { void flushOfflineQueue() }, [])

  // 防抖同步草稿：输入 1000ms 后把「当前正文」同步成草稿（本地 IndexedDB 优先，服务器尽力而为）。
  // ★ 空文本也要进来 —— 那一趟是「清掉草稿」，见 syncDraft 的注释。
  function onDraftChange(text: string) {
    userEditedRef.current = true // 只有这里置位：这是用户改正文的唯一入口
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      void syncDraft(text)
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

  // 放弃草稿（横幅上的按钮）：与「正文被清空」走同一条清理路径（clearStoredDraft）
  async function discardDraft() {
    await clearStoredDraft()
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
      // 地名写的是**结构化三级**（省/市/区）——服务端在写入三级时会顺手清掉旧的单一地名串。
      const [place, weather] = await Promise.all([
        isAutoPlaceNameEnabled() ? clientReverseGeocode(latitude, longitude) : Promise.resolve(null),
        isWeatherEnabled() ? fetchWeather(latitude, longitude) : Promise.resolve(null),
      ])
      if (place) Object.assign(patch, locationPatch(place))
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
          wordCount: countWords(body), // 纯文本口径（剥离 Markdown 标记），与详情页/列表一致
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
          wordCount: countWords(body),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          // 新建的笔记默认未收藏（收藏入口在查看页，此刻这篇还没有 id 可点）
          starred: false,
          // 同理默认未归档（归档入口也在查看页）
          archivedAt: null,
          queuedAt: Date.now(),
        })
        if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
        draftEpochRef.current++
        await clearLocalDraft()
        const now = new Date()
        setSavedTime(now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }))
        setSavedOffline(true)
        setStatus('saved')
        playSaveSoundIfEnabled()
        setShowConfetti(true)
        // 编辑器回到全新状态：连带把「用户改过」复位，免得切 tab 卸载时又发一次多余的清草稿请求
        setText(''); textRef.current = ''; userEditedRef.current = false
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
      playSaveSoundIfEnabled() // 清脆保存音效（Web Audio 合成）
      setShowConfetti(true) // 游戏获奖式庆祝反馈
      setText(''); textRef.current = ''; userEditedRef.current = false
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current)
      statusTimeoutRef.current = setTimeout(() => { setStatus('idle'); setShowConfetti(false) }, 2000)
      // 定位与元数据异步补写：此刻保存反馈已经完成，用户可立即继续操作
      if (savedEntry?.id) void backfillLocation(savedEntry.id)
    } catch {
      setStatus('error')
    }
  }

  // 工具条插入标记后还原选区、预览滚动定位、切换编辑/预览、工具条动作——
  // 这四件事都在 useMarkdownEditor 里（与详情页编辑态共用一份实现，见该文件顶部注释）。

  const today = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })

  return (
    // ── 布局（2026-10-06 第二次改，用户反馈「键盘弹出后往下滑，保存按钮下方出现大片空白」）──
    //
    // 改造前/后：
    //   旧：根容器 `overflow-hidden` + 键盘时 `flex: 0 0 <可见高>`，**整页**（含页头、工具条、
    //       底部按钮）一起被压进可见区。后果见下面 header 处的说明。
    //   新：根容器**不滚动也不压高度**（就吃 flex-1 的剩余空间）；页头、工具条、底部按钮
    //       全部固定；**只有正文编辑区滚动**。
    //
    // 为什么不再用 useVisibleViewportHeight 压高度：见 header 后的注释块。
    <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col px-5">
      {/* viewTransitionName：页面切换动画中页头保持固定（空间锚点） */}
      <header className="py-4">
        {/* 页头不再放「全部日记」「设置」图标——这两个目的地已由底部 TabBar 承担，
            同一入口出现两处只会让页头变杂（也符合 iOS 习惯：顶部不放重复的 tab 入口） */}
        <OrbitLogo />
        <div className="mt-1 flex items-center justify-between text-sm text-neutral-500 dark:text-neutral-400">
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
      {/* ★ 键盘适配（2026-10-06，本轮改法）：
          正文编辑区与底部按钮**不再**跟着键盘上移。这里曾经用 `useVisibleViewportHeight()`
          把整页压到可见区高度，那正是「保存按钮下方一大片空白」的成因：
            · iOS 的键盘不改变布局视口，只让 **visualViewport** 变小；
            · 被压矮的那一列下面，**布局视口那一整段仍然存在**（可滚动、且被 `.qo-app-root`
              的整页底色填充）；
            · 用户在键盘弹起时往下滑 = 内层滚动/橡皮筋把**可视视口**在布局视口里往上滚 ⇒
              底部露出「无人绘制的那段空白」，再往下才是布局在文档底部的 TabBar。
          ⇒ 现在的做法是：**页头 / 工具条 / 底部按钮不滚不动，只有正文编辑区滚动**
             （textarea 是自身可滚动的元素）。键盘弹起时，光标在可滚动的 textarea 内部被算成
             「可见」，iOS 就不会再去滚可视视口 —— 这正是用户要的「整个页面不能整体下滑，
             只有文字输入区域可以滚动」。所以本页**不再需要 visibleHeight**。
          ⇒ 底部按钮「位置不变」也是明确要求（退路方案），现在直接就是固定不动的。
          唯一的取舍：可见区变矮后，底部按钮会落进键盘**下面**（看不见）。与其把它举上去、
          换来一片能滑出来的空白，不如让它老实待在底部 —— 需要保存时收起键盘即可，
          而「键盘弹起时到底该不该让保存按钮可见」在下面的 footer 处另有说明。 */}
      {/* 去年的今天：往年同月日的随机一篇，点击查看详情；右侧 ✕ 隐藏（今天不再显示） */}
      {isOnThisDayEnabled() && !otdHidden && onThisDay && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-neutral-100 bg-neutral-50/60 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/40">
          <Link href={`/entry/${onThisDay.id}`} className="min-w-0 flex-1 active:opacity-60">
            <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
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
            className="shrink-0 px-0.5 text-sm leading-5 text-neutral-500 active:opacity-60 dark:text-neutral-400"
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
            className="shrink-0 py-1.5 text-xs text-neutral-500 dark:text-neutral-400 active:opacity-60"
          >
            放弃
          </button>
        </div>
      )}
      {/* 每日提示：随机一句，点击换一条（写作灵感）。显示条件见 isPromptVisible（偏好开关）。 */}
      {isPromptVisible && (
        <button
          onClick={() => setPromptIdx(nextPromptIndex(promptIdx))}
          className="mb-2 flex items-start gap-1.5 text-left text-xs leading-relaxed text-neutral-500 dark:text-neutral-400 active:opacity-60"
        >
          <span className="shrink-0">💭</span>
          <span>{PROMPTS[promptIdx]}</span>
        </button>
      )}
      {/* Markdown 工具条：放在**编辑区顶部**（输入框之上）。
          原先在输入框下方——手机输入时键盘从底部弹出会把整条盖住，工具条等于不可用
          （2026-09-30 用户反馈）。横条本身与详情页编辑态共用 components/MarkdownToolbar.tsx。
          与下方输入框之间隔开 16px：由**下面这个滚动容器的 pt-4** 承担。
          工具条**不设自己的 padding-top**：它必须和页头、底部按钮一样是「固定不动」的一条，
          自己长高会挤掉正文的空间；间距改由滚动区的上内边距提供，正文滚动时也就不会贴住它。 */}
      <MarkdownToolbar
        preview={preview}
        disabled={status === 'saving'}
        onAction={applyToolbar}
        onTogglePreview={togglePreview}
      />
      {/* ★ 正文区：外层**只做布局，不是滚动容器**；滚动由「当前显示的那一支」自己承担：
            编辑态 = AutoTextarea 自身（flex-1 + overflow-y-auto），预览态 = 下面那个 div。
           ★ 不要在这层再写 `overflow-y-auto`（2026-10-09 用户反馈「新建笔记文字较多时，
             收起键盘后输入区域偶发无法上下滑动」）：编辑态里 textarea 是 flex-1，高度正好
             等于本容器 ⇒ **本容器永远不产生溢出，却仍是一个「可滚动元素」**。于是手指与真正的
             滚动条之间多隔了一层「能滚但不滚」的容器，iOS 上这类冗余滚动容器会偶发吞掉 pan 手势。
             内容少时不溢出、看不出问题；内容多时才暴露 —— 与用户描述的「文字内容较多时才出现」吻合。
             证据：`Temp/qo-keyboard-probe/nested-scroll.mjs`（旧：可滚动祖先 2 层、其中 1 层冗余；
             新：每个分支恰好 1 层）。守卫 K9/K11。
           `pt-4` 提供与工具条的 16px 间距；`pb-2` 与改造前预览区一致。
           min-h-0 + flex + flex-col 三者都必须有：flex 子项默认 min-height:auto，不加压不下去；
           而 `flex-1` 只在 flex 容器里才有意义（漏了 `flex` ⇒ 输入区塌成 2~3 行，守卫 K9）。 */}
      <div className="flex min-h-0 flex-1 flex-col pt-4 pb-2">
        {preview ? (
          <div ref={previewRef} className="min-h-0 flex-1 overflow-y-auto">
            {text.trim()
              ? <Markdown source={text} />
              : <p className="text-sm text-neutral-500 dark:text-neutral-400">还没有内容</p>}
          </div>
        ) : (
          <AutoTextarea
            textareaRef={editorRef}
            value={text}
            onChange={(v) => { setText(v); textRef.current = v; onDraftChange(v) }}
            placeholder={entryCount === 0 ? '写下第一篇日记吧' : '在此处输入内容...'}
            autoFocus
            disabled={status === 'saving'}
          />
        )}
      </div>
      {/* 空状态引导：首次（无任何日记）时显示柔和渐变引导 */}
      {entryCount === 0 && (
        <div className="flex flex-col items-center gap-2 py-5">
          <span className="text-2xl">🌱</span>
          <p className="bg-linear-to-r from-orange-500 via-rose-400 to-violet-500 bg-clip-text text-sm font-medium text-transparent">
            写下第一篇日记，开始属于你的 Orbit
          </p>
        </div>
      )}
      {/* 底部区：整体贴底（状态行 + 保存按钮），正文滚动区弹性占中间。
          ★ 键盘弹起时它**不上移**（用户要求「整个页面不能整体下滑」「退而求其次位置保持不变」）：
          代价是被键盘遮住，需要保存时收起键盘。宁可如此，也不要上一版那种"举上去然后在下面
          露出一片能滑出来的空白"。
          必须有下内边距：main 自身没有 pb，而 TabBar 就紧贴在它下方（(app)/layout 里
          两者是相邻的兄弟节点，中间没有任何间隔）——少了这段留白，渐变实心按钮的下边缘
          会正好压在 TabBar 的 1px 上边框上，视觉上就是「按钮与 TabBar 重叠」。
          底部安全区不再由这里承担——(app)/layout 的 TabBar 已经自带 pb-safe，
          此处若再加 env(safe-area-inset-bottom) 会叠出一段空白。
          也不能用 safe-pb + pb-4 组合——.safe-pb 是 unlayered 自定义类，会覆盖 Tailwind 的 pb-4
          relative：给 ConfettiBurst 当定位上下文（它按 footer 顶边锚定，不再用 fixed + 像素偏移） */}
      <footer className="relative shrink-0 pb-4 pt-2">
        {showConfetti && <ConfettiBurst />}
        <p className="mb-3 text-center text-xs text-neutral-500 dark:text-neutral-400">
          {status === 'saving' && '正在保存…'}
          {status === 'saved' && (
            <span className="animate-pop inline-block text-sm font-semibold text-emerald-500">
              {savedOffline ? `✓ 已离线保存 · 联网后自动同步` : `✓ 已保存 · ${savedTime}`}
            </span>
          )}
          {status === 'error' && '保存失败，请重试'}
          {status === 'idle' && text.trim().length > 0 && `共 ${countWords(text)} 字`}
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
