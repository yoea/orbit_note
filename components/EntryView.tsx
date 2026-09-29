'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ConfirmDialog from '@/components/ConfirmDialog'
import { getDek } from '@/lib/client/session'
import { decryptText, encryptText } from '@/lib/client/crypto/encryption'
import { copyText } from '@/lib/client/clipboard'
import { clientReverseGeocode } from '@/lib/client/geocode'
import { getPosition, parseCoords } from '@/lib/client/location'
import { isAutoPlaceNameEnabled } from '@/lib/client/prefs'
import { cacheEntriesPage, getCachedEntryById, getQueuedEntryById, removeCachedEntry, removeQueuedEntry, updateQueuedEntry } from '@/lib/client/offline'
import { weatherEmoji } from '@/lib/client/weather'
import { playSaveSound } from '@/lib/client/sound'
import { BRAND_GRADIENT_CLASS, PRIMARY_BUTTON_CLASS } from '@/lib/client/ui'
import Toast from './Toast'

// 行结构 = 服务端整行（含密文）；与 EncryptedEntry 同构（wordCount 为明文计数字段，
// 详情页虽不用，但列表缓存/离线兜底按整行存取）
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
  locationName: string | null
  weather: string | null
  timezone: string | null
}

// 日记详情视图（原生路由页 /entry/[id] 渲染；DEK 会话级持久化，导航/重载自动恢复）
export default function EntryView({ id }: { id: string }) {
  const router = useRouter()
  const [entry, setEntry] = useState<Entry | null>(null)
  const [plain, setPlain] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [decryptFailed, setDecryptFailed] = useState(false)
  // 「未同步」标记：条目来自离线写队列（新增后尚未上传服务器）。
  // 这类条目离线可编辑（改队列密文）/可删除（移出队列）；缓存条目离线只读。
  const [pendingSync, setPendingSync] = useState(false)
  // 条目在服务器上真实存在（加载时 GET 成功）。与 pendingSync 同时为真 =
  // 「冲刷已成功但队列尚未清空」的竞态：此时删除要两边都清（队列项 + 服务器行）。
  const [serverBacked, setServerBacked] = useState(false)
  // 网络不可达、数据来自本地（缓存或队列）：此时云端条目不可改（PATCH/DELETE 发不出去）
  const [localReadonly, setLocalReadonly] = useState(false)
  const [coordsCopied, setCoordsCopied] = useState(false)
  // —— 定位相关：与正文保存完全解耦 ——
  // 任何定位改动（添加 / 移除 / 补地点名）都立即 PATCH 落库，不经过底部「保存修改」按钮。
  // 该按钮只负责正文内容。
  const [addLocationOpen, setAddLocationOpen] = useState(false)
  const [coordInput, setCoordInput] = useState('')
  const [coordError, setCoordError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false) // 正在读取 GPS
  const [savingLocation, setSavingLocation] = useState(false) // 正在 PATCH 定位
  const [confirmRemoveLocation, setConfirmRemoveLocation] = useState(false)
  // 打开详情页自动补地点名：同一篇只尝试一次
  const autoGeocodeTriedRef = useRef<string | null>(null)
  const [confirmCancelEdit, setConfirmCancelEdit] = useState(false)
  // 编辑保存成功的短暂提示（查看模式下显示约 2 秒）
  const [savedFlash, setSavedFlash] = useState(false)
  const savedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 进入编辑时的内容快照：取消编辑（不保存）时恢复，丢弃编辑中的改动
  const editSnapshotRef = useRef('')
  const coordsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 复制坐标到剪贴板并提示；无地点名时顺带查询一次（已有点名不重复查询，失败静默保持坐标）
  async function copyCoords() {
    if (entry?.latitude == null || entry.longitude == null) return
    const lat = entry.latitude // 闭包内提取，避免 TS 收缩丢失
    const lon = entry.longitude
    const ok = await copyText(`${lat.toFixed(6)}, ${lon.toFixed(6)}`)
    if (ok) {
      setCoordsCopied(true)
      if (coordsTimerRef.current) clearTimeout(coordsTimerRef.current)
      coordsTimerRef.current = setTimeout(() => setCoordsCopied(false), 2000)
    }
    if (!entry.locationName) {
      void (async () => {
        try {
          // 客户端直调反查（大陆可达、CORS 开放），成功后 PATCH 存库并更新界面
          const name = await clientReverseGeocode(lat, lon)
          if (name) {
            await fetch(`/api/diary/${entry.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ locationName: name }),
            })
            setEntry((prev) => prev ? { ...prev, locationName: name } : prev)
          }
        } catch { /* 查询失败静默：保持坐标显示 */ }
      })()
    }
  }

  // 定位写库入口：所有定位改动都走这里，**立即生效**，与底部「保存修改」按钮无关。
  // PATCH 不带 ciphertext → 服务端不更新 updatedAt，所以补/改定位不算「编辑」，
  // 详情页不会因此显示「编辑于」。
  async function persistLocation(patch: Record<string, unknown>) {
    const res = await fetch(`/api/diary/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) throw new Error('保存位置失败')
    const data = await res.json() as { entry: Entry }
    setEntry((prev) => (prev ? { ...prev, ...data.entry } : prev))
  }

  // 地点名异步反查并补写（尽力而为）：失败静默——详情页的自动补查与点击坐标都能兜底
  function backfillLocationName(latitude: number, longitude: number) {
    if (!isAutoPlaceNameEnabled()) return
    void (async () => {
      const name = await clientReverseGeocode(latitude, longitude)
      if (!name) return
      try { await persistLocation({ locationName: name }) } catch { /* 忽略 */ }
    })()
  }

  // 编辑态「添加定位」之一：读取当前定位。超时给足（用户主动点击、有明确等待预期，
  // 不像保存那样赶时间）。拿到坐标立即落库，地点名随后异步补。
  async function applyCurrentLocation() {
    if (locating || savingLocation) return
    setLocating(true)
    setCoordError(null)
    let pos: Awaited<ReturnType<typeof getPosition>> = null
    try {
      pos = await getPosition(15_000)
    } finally {
      setLocating(false)
    }
    if (!pos) { setCoordError('定位失败或超时，请检查定位权限后重试'); return }
    const { latitude, longitude, accuracy } = pos
    setSavingLocation(true)
    try {
      await persistLocation({ latitude, longitude, locationAccuracy: accuracy })
      setAddLocationOpen(false)
      backfillLocationName(latitude, longitude)
    } catch {
      setCoordError('保存位置失败，请重试')
    } finally {
      setSavingLocation(false)
    }
  }

  // 编辑态「添加定位」之二：手填坐标，立即落库。
  // 接受 "25.049642, 102.676280"（逗号分隔、逗号后空格忽略、兼容中文全角逗号），见 parseCoords。
  async function applyManualCoords() {
    if (savingLocation) return
    const parsed = parseCoords(coordInput)
    if (!parsed) {
      setCoordError('格式不对，应为「纬度, 经度」，例如 25.049642, 102.676280')
      return
    }
    setSavingLocation(true)
    try {
      await persistLocation({ latitude: parsed.latitude, longitude: parsed.longitude, locationAccuracy: null })
      setCoordInput('')
      setCoordError(null)
      setAddLocationOpen(false)
      backfillLocationName(parsed.latitude, parsed.longitude)
    } catch {
      setCoordError('保存位置失败，请重试')
    } finally {
      setSavingLocation(false)
    }
  }

  // 移除定位：立即生效且不可逆，调用前由 UI 二次确认。
  // 服务端在 latitude 为 null 时会把 locationName 一并清空。
  async function removeLocationNow() {
    setConfirmRemoveLocation(false)
    setSavingLocation(true)
    try {
      await persistLocation({ latitude: null, longitude: null, locationAccuracy: null })
    } catch {
      setError('移除定位失败，请重试')
    } finally {
      setSavingLocation(false)
    }
  }

  // 收起「添加定位」面板并清理输入（坐标已在上一步落库，这里没有待保存内容）
  function closeAddLocation() {
    setAddLocationOpen(false)
    setCoordInput('')
    setCoordError(null)
  }

  useEffect(() => {
    void (async () => {
      try {
        const dek = getDek()
        if (!dek) throw new Error('未解锁')
        const res = await fetch(`/api/diary/${id}`).catch(() => null)
        // 未同步笔记（离线新增、尚未上传）：服务器上还没有这条，但列表里可见可点开
        const queued = await getQueuedEntryById(id)
        let loaded: Entry | null = null
        let fromServer = false
        if (res) {
          if (res.status === 404) {
            // 服务器没有（未同步笔记，或本地残留）：回退本地队列/缓存，不当作「已删除」跳走
            loaded = queued ?? (await getCachedEntryById(id))
          } else if (res.ok) {
            loaded = ((await res.json()) as { entry: Entry }).entry
            fromServer = true
          } else {
            throw new Error('加载失败')
          }
        } else {
          // 网络不可达：回退本地——密文缓存 + 离线写队列
          loaded = (await getCachedEntryById(id)) ?? queued
        }
        if (!loaded) { router.replace('/diary'); return }
        const entry = loaded
        setServerBacked(fromServer)
        setPendingSync(queued !== null)
        // 网络不可达且数据来自本地缓存（非未同步笔记）→ 离线只读（PATCH/DELETE 发不出去）
        setLocalReadonly(res === null && queued === null)
        setEntry(entry)
        if (fromServer) void cacheEntriesPage([entry]) // 在线成功顺手缓存单条（密文）
        try {
          setPlain(await decryptText(dek, entry.ciphertext, entry.iv))
          setDecryptFailed(false)
        } catch {
          setPlain('(解密失败，数据可能已损坏)')
          setDecryptFailed(true)
        }
      } catch {
        setError('连接失败，请检查网络后重试')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // 打开详情页自动补地点名：有坐标但地点名为空 → 反查 → PATCH 存库 + 更新界面。
  // 受「自动补全地点名」开关控制（关闭后不自动外发坐标，点击坐标仍可手动查询）。
  // 发送前坐标会被模糊到约 1km（见 geocode.ts 的 coarsenCoordinate）。
  // 同一篇每次加载只自动尝试一次；失败写 30 分钟冷却，避免反复打第三方接口。
  useEffect(() => {
    if (!entry) return
    const entryId = entry.id
    const latitude = entry.latitude
    const longitude = entry.longitude
    if (latitude == null || longitude == null || entry.locationName) return
    if (!isAutoPlaceNameEnabled()) return
    if (autoGeocodeTriedRef.current === entryId) return
    autoGeocodeTriedRef.current = entryId
    const cooldownKey = `qo-geocode-fail:${entryId}`
    try {
      const failedAt = Number(sessionStorage.getItem(cooldownKey) ?? 0)
      if (failedAt && Date.now() - failedAt < 30 * 60_000) return
    } catch { /* sessionStorage 不可用则忽略冷却 */ }
    void (async () => {
      try {
        const name = await clientReverseGeocode(latitude, longitude)
        if (!name) {
          try { sessionStorage.setItem(cooldownKey, String(Date.now())) } catch { /* 忽略 */ }
          return
        }
        await fetch(`/api/diary/${entryId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locationName: name }),
        })
        try { sessionStorage.removeItem(cooldownKey) } catch { /* 忽略 */ }
        setEntry((prev) => (prev && prev.id === entryId ? { ...prev, locationName: name } : prev))
      } catch {
        try { sessionStorage.setItem(cooldownKey, String(Date.now())) } catch { /* 忽略 */ }
      }
    })()
  }, [entry])

  const saveEdit = useCallback(async () => {
    if (!entry || !plain.trim()) return
    setBusy(true)
    try {
      const dek = getDek()!
      const { ciphertext, iv } = await encryptText(dek, plain)
      const wordCount = plain.trim().length
      // 未同步笔记（离线新增、尚未上传）：编辑直接改写队列项密文，不走 PATCH——
      // 服务器上还没有这条，PATCH 只会 404。同步时上传的自然是最新密文。
      if (pendingSync) {
        const updated = await updateQueuedEntry(id, { ciphertext, iv, wordCount })
        if (!updated) throw new Error('保存失败')
        const nowIso = new Date().toISOString()
        setEntry((prev) => prev ? { ...prev, ciphertext, iv, wordCount, updatedAt: nowIso } : prev)
        setAddLocationOpen(false)
        setCoordInput('')
        setCoordError(null)
        setError(null)
        setEditing(false)
        playSaveSound()
        setSavedFlash(true)
        if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current)
        savedFlashTimerRef.current = setTimeout(() => setSavedFlash(false), 2000)
        return
      }
      // 只保存正文。定位的增删已在操作当时立即落库（见 persistLocation），
      // 不随本次提交——该 PATCH 不带 ciphertext，服务端不会更新 updatedAt。
      const body: Record<string, unknown> = { ciphertext, iv, wordCount }
      const res = await fetch(`/api/diary/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('保存失败')
      const data = await res.json()
      setEntry((prev) => prev ? { ...prev, ...data.entry } : prev)
      // 本地缓存同步更新：否则离线模式（读缓存）看到的还是修改前的正文
      void cacheEntriesPage([data.entry as Entry])
      // 收起「添加定位」面板（坐标早已落库，这里没有待保存内容）
      setAddLocationOpen(false)
      setCoordInput('')
      setCoordError(null)
      setError(null)
      setEditing(false)
      // 成功提示：短暂显示「✓ 已保存」后自动消失
      playSaveSound()
      setSavedFlash(true)
      if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current)
      savedFlashTimerRef.current = setTimeout(() => setSavedFlash(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }, [entry, plain, id, pendingSync])

  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const remove = useCallback(async () => {
    // 未同步笔记：还没上过服务器，移出本地队列即完成删除。
    // 若它同时也已存在于服务器（冲刷已成功、队列尚未清空的竞态），补一次服务端删除。
    if (pendingSync) {
      await removeQueuedEntry(id)
      if (serverBacked) {
        try {
          await fetch(`/api/diary/${id}`, { method: 'DELETE' })
        } catch { /* 离线：服务器那一条仍在，联网后仍在列表里可见 */ }
        await removeCachedEntry(id)
      }
      router.replace('/diary')
      return
    }
    try {
      const res = await fetch(`/api/diary/${id}`, { method: 'DELETE' })
      if (res.status === 401) { router.replace('/login'); return }
      if (res.ok) {
        // 本地密文缓存必须同步剔除：只删服务器会让这条在离线模式里「复活」
        // （离线列表读缓存——此前缓存只增不减，正是「在线看不到、离线看得到」的根因）
        await removeCachedEntry(id)
        await removeQueuedEntry(id)
        router.replace('/diary')
        return
      }
      setError('删除失败，请重试')
    } catch {
      setError('删除失败，请重试')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, pendingSync, serverBacked])

  if (error && !entry) {
    return (
      <main className="mx-auto flex h-full w-full max-w-md items-center justify-center px-5 safe-pt">
        <div className="text-center">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{error}</p>
          <button onClick={() => window.location.reload()} className="mt-4 rounded-xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-6 py-3 text-sm font-medium text-white">重试</button>
        </div>
      </main>
    )
  }

  if (!entry) return <main className="mx-auto h-full w-full max-w-md overflow-y-auto px-5 safe-pt" />

  const created = new Date(entry.createdAt)
  // 编辑过（updatedAt 晚于 createdAt）→ 额外显示"编辑于"；否则只显示创建时间
  const editedAt = new Date(entry.updatedAt)
  const isEdited = editedAt.getTime() !== created.getTime()
  const fmtDate = (d: Date) =>
    `${d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
  // entry 始终是服务端最新状态（定位改动已即时落库），无需本地暂存值
  const { latitude: entryLat, longitude: entryLon } = entry
  const hasCoords = entryLat != null && entryLon != null
  const displayCoords = entryLat != null && entryLon != null ? `${entryLat.toFixed(6)}, ${entryLon.toFixed(6)}` : ''
  const locationBusy = locating || savingLocation
  return (
    <main className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col overflow-y-auto px-5 safe-pt">
      {/* viewTransitionName：页面切换动画中页头保持固定（空间锚点） */}
      <header className="page-header relative flex items-center justify-between py-3">
        {/* iOS 原生风格返回：chevron 箭头（原生路由返回，右滑手势同样生效）；标题绝对居中。
            字号：‹ 为半角字符视觉偏小（text-3xl），＋ 为全角字符视觉偏大（text-xl）——视觉平衡 */}
        <Link href="/diary" aria-label="返回" scroll={false} className="-ml-1 px-1 text-3xl leading-none text-neutral-500 dark:text-neutral-400">
          ‹
        </Link>
        <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold">日记</h1>
        {editing ? (
          /* 取消编辑：无改动直接退出；有改动弹确认（丢弃则恢复编辑前内容） */
          <button
            onClick={() => {
              // 正文无改动 → 直接退出；否则弹确认。
              // 定位改动是即时落库的，不参与这里的「有无改动」判断，也不会被取消操作回滚。
              if (plain === editSnapshotRef.current) {
                setEditing(false)
                closeAddLocation()
                return
              }
              setConfirmCancelEdit(true)
            }}
            className="text-sm text-neutral-500 dark:text-neutral-400"
          >
            取消
          </button>
        ) : (
          /* 右上角加号：返回首页（新建笔记页） */
          <Link href="/" aria-label="新建笔记" className="text-xl font-light leading-none text-neutral-500 dark:text-neutral-400 active:opacity-60">
            ＋
          </Link>
        )}
      </header>
      <p className="flex flex-wrap items-center gap-2 text-sm tabular-nums text-neutral-500 dark:text-neutral-400">
        {fmtDate(created)}
        {/* 字数在解密时计算（与编辑器底部"共 x 字"一致：trim 后长度） */}
        {!decryptFailed && <> · {plain.trim().length} 字</>}
        {/* 未同步徽标：离线新增、尚未上传服务器的笔记（同步后自动消失） */}
        {pendingSync && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden>
              <path d="M17.5 19a4.5 4.5 0 1 0 0-9h-1.8A7 7 0 1 0 4 14.7" />
              <line x1="2" y1="2" x2="22" y2="22" />
            </svg>
            未同步
          </span>
        )}
      </p>
      {/* 定位信息：查看与编辑共用同一位置与样式（字数行下方）——优先地点名，点击复制精确坐标。
          编辑态且原笔记无坐标时，改为展示「添加定位」入口 */}
      {hasCoords ? (
        <div className="mt-1">
          {/* 定位信息（左）+ 实时天气（右，同行两端对齐） */}
          <div className="flex items-baseline justify-between gap-2">
            {/* 点击复制精确坐标（有地址时复制坐标；无地址时同时触发地点补查） */}
            <button
              onClick={() => void copyCoords()}
              className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400 active:opacity-60"
            >
              <span className="mr-0.5 text-[10px]">📍</span>
              {/* 有地址信息只显示地址；没有则只显示经纬度（不显示精度） */}
              {entry.locationName ?? displayCoords}
              {/* 已复制提示：跟在地点名/坐标后面 */}
              {coordsCopied && <span className="ml-1.5 text-[10px] font-medium text-emerald-500">已复制坐标</span>}
            </button>
            {/* 保存时记录的实时天气（有则显示，右对齐） */}
            {entry.weather && (
              <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{weatherEmoji(entry.weather)}{entry.weather}</span>
            )}
          </div>
          {/* 未同步笔记不提供定位增删：定位走服务端 PATCH，而这条还没上服务器 */}
          {editing && !pendingSync && (
            <button
              onClick={() => setConfirmRemoveLocation(true)}
              disabled={locationBusy}
              className="ml-2 text-xs text-red-500 underline disabled:opacity-50"
            >
              移除定位信息
            </button>
          )}
        </div>
      ) : editing && !pendingSync ? (
        <div className="mt-1">
          {!addLocationOpen ? (
            <button onClick={() => setAddLocationOpen(true)} className="text-xs text-neutral-500 dark:text-neutral-400 underline">
              ＋ 添加定位
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
              <button
                onClick={() => void applyCurrentLocation()}
                disabled={locationBusy}
                className="rounded-lg bg-neutral-100 py-2 text-xs text-neutral-700 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-200"
              >
                {locating ? '正在定位…' : savingLocation ? '正在保存…' : '读取当前定位'}
              </button>
              <div className="flex items-center gap-2">
                <input
                  value={coordInput}
                  onChange={(e) => { setCoordInput(e.target.value); setCoordError(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void applyManualCoords() } }}
                  placeholder="25.049642, 102.676280"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-xs tabular-nums outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                />
                <button
                  onClick={() => void applyManualCoords()}
                  disabled={!coordInput.trim() || locationBusy}
                  className="shrink-0 rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-700 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-200"
                >
                  确定
                </button>
              </div>
              <p className="text-[10px] text-neutral-500 dark:text-neutral-400">粘贴「纬度, 经度」即可，确定后立即保存</p>
              {coordError && <p className="text-[10px] text-red-500">{coordError}</p>}
              <button onClick={closeAddLocation} className="self-start text-[10px] text-neutral-500 dark:text-neutral-400 underline">
                取消
              </button>
            </div>
          )}
        </div>
      ) : null}
      {editing ? (
        <>
          {/* 输入框：flex-1 弹性填充剩余空间（min-h-0 允许收缩）——编辑区完整填满视口 */}
          <textarea
            value={plain}
            onChange={(e) => setPlain(e.target.value)}
            disabled={busy}
            className="mt-3 min-h-0 w-full flex-1 resize-none bg-transparent text-base leading-relaxed outline-none disabled:opacity-60"
          />
          {/* 底部区：整体贴底（上次编辑 + 保存按钮），输入框弹性占中间。
              必须有下内边距：main 自身没有 pb，而 TabBar 就紧贴在它下方（(app)/layout 里
              两者是相邻的兄弟节点，中间没有任何间隔）——少了这段留白，渐变实心按钮的下边缘
              会正好压在 TabBar 的 1px 上边框上，视觉上就是「按钮与 TabBar 重叠」。
              查看态没这问题，只因那条操作栏自带 py-4。
              取 16px（pb-4）与查看态操作栏的下内边距一致；底部安全区仍由 TabBar 的
              pb-safe 承担，这里不能写 safe-pb（否则叠出双份留白）。 */}
          <div className="mt-auto flex flex-col gap-2 pb-4 pt-2">
            {isEdited && (
              <p className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">上次编辑 {fmtDate(editedAt)}</p>
            )}
            <button
              onClick={() => void saveEdit()}
              disabled={busy || !plain.trim()}
              /* 样式取全宽主按钮常量——与写页「保存」逐字符同一份（含 py-4 高度、disabled:opacity-50
                 与按下 scale 反馈），两侧高度/圆角/禁用态不会再各自漂移。 */
              className={`${PRIMARY_BUTTON_CLASS} ${BRAND_GRADIENT_CLASS}`}
            >
              {busy ? '保存中…' : '保存修改'}
            </button>
          </div>
        </>
      ) : (
        <>
          {/* 正文：小一号字体（text-base）+ 每行分段加段间距（单换行也有明显间距；空行自然形成更大间隔） */}
          <div className="mt-4 text-base leading-relaxed text-neutral-800 dark:text-neutral-200">
            {plain.split('\n').map((line, i) => (
              <p key={i} className="mb-2 whitespace-pre-wrap last:mb-0">{line}</p>
            ))}
          </div>
        </>
      )}
      {decryptFailed && (
        <p className="mt-3 text-sm text-red-500">原内容无法解密，无法编辑，否则将覆盖原数据</p>
      )}
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      {!editing && (
        /* 底部操作栏：左「编辑于」（编辑过才显示，小 2 号），右「编辑 / 删除」 */
        <div className="mt-auto flex items-center justify-between gap-6 border-t border-neutral-100 py-4 dark:border-neutral-800">
          {isEdited ? (
            <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">编辑于 {fmtDate(editedAt)}</span>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-6">
            {/* 离线只读：云端缓存条目在断网时不可编辑/删除（PATCH/DELETE 发不出去，
                硬点只会「保存失败」）。未同步笔记（pendingSync）不受限——编辑/删除
                都在本地队列完成。 */}
            <button
              onClick={() => { editSnapshotRef.current = plain; closeAddLocation(); setEditing(true) }}
              disabled={decryptFailed || (localReadonly && !pendingSync)}
              className="text-sm text-neutral-500 dark:text-neutral-400 active:opacity-60 disabled:opacity-40"
            >
              编辑
            </button>
            <button
              onClick={() => setConfirmingDelete(true)}
              disabled={localReadonly && !pendingSync}
              className="text-sm text-red-500 active:opacity-60 disabled:opacity-40"
            >
              删除
            </button>
          </div>
        </div>
      )}
      {/* 编辑保存成功通知（小型弹窗，自动消失） */}
      {savedFlash && <Toast message="✓ 已保存" />}
      {confirmCancelEdit && (
        <ConfirmDialog
          title="确定不保存所做修改吗？"
          message="放弃后编辑内容将丢失，仅保留编辑前的内容。"
          confirmText="不保存"
          cancelText="继续编辑"
          destructive
          onConfirm={() => {
            setConfirmCancelEdit(false)
            setPlain(editSnapshotRef.current) // 恢复编辑前内容
            closeAddLocation() // 收起定位面板（已落库的定位不回滚）
            setEditing(false)
          }}
          onCancel={() => setConfirmCancelEdit(false)}
        />
      )}
      {/* 移除定位：即时生效且不可逆，故二次确认 */}
      {confirmRemoveLocation && (
        <ConfirmDialog
          title="确定移除定位信息吗？"
          message="坐标与地点名会立即从这篇日记中删除，无法恢复。"
          confirmText="移除"
          cancelText="取消"
          destructive
          onConfirm={() => void removeLocationNow()}
          onCancel={() => setConfirmRemoveLocation(false)}
        />
      )}
      {confirmingDelete && (
        <ConfirmDialog
          title="确定删除这篇日记吗？"
          message="删除后无法恢复。"
          confirmText="删除"
          cancelText="取消"
          destructive
          onConfirm={() => { setConfirmingDelete(false); void remove() }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </main>
  )
}
