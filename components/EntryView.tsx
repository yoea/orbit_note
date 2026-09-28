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
import { weatherEmoji } from '@/lib/client/weather'
import { playSaveSound } from '@/lib/client/sound'
import Toast from './Toast'

interface Entry {
  id: string
  ciphertext: string
  iv: string
  createdAt: string
  updatedAt: string
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
  const [coordsCopied, setCoordsCopied] = useState(false)
  const [removeLocation, setRemoveLocation] = useState(false)
  // —— 编辑态「添加定位」（原笔记没有坐标时才有意义）——
  // pendingLocation 是待保存的坐标（点「保存修改」时才随 PATCH 落库）
  const [pendingLocation, setPendingLocation] = useState<
    { latitude: number; longitude: number; accuracy: number | null; name: string | null } | null
  >(null)
  const [addLocationOpen, setAddLocationOpen] = useState(false)
  const [coordInput, setCoordInput] = useState('')
  const [coordError, setCoordError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
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

  // 编辑态「添加定位」：读取当前定位。超时给足（用户主动点击、有明确等待预期，
  // 不像保存那样赶时间）。拿到坐标立刻回填界面，地点名异步补——失败静默，
  // 保存后详情页的自动补查会再兜一次。
  async function applyCurrentLocation() {
    if (locating) return
    setLocating(true)
    setCoordError(null)
    let pos: Awaited<ReturnType<typeof getPosition>> = null
    try {
      pos = await getPosition(15_000)
    } finally {
      setLocating(false)
    }
    if (!pos) { setCoordError('定位失败或超时，请检查定位权限后重试'); return }
    setPendingLocation({ latitude: pos.latitude, longitude: pos.longitude, accuracy: pos.accuracy, name: null })
    setAddLocationOpen(false)
    setRemoveLocation(false)
    if (isAutoPlaceNameEnabled()) {
      const name = await clientReverseGeocode(pos.latitude, pos.longitude)
      if (name) setPendingLocation((prev) => (prev ? { ...prev, name } : prev))
    }
  }

  // 编辑态「添加定位」：手填坐标。接受 "25.049642, 102.676280" 这种形式
  // （逗号分隔、逗号后空格自动忽略、兼容中文全角逗号），见 parseCoords。
  function applyManualCoords() {
    const parsed = parseCoords(coordInput)
    if (!parsed) {
      setCoordError('格式不对，应为「纬度, 经度」，例如 25.049642, 102.676280')
      return
    }
    setPendingLocation({ latitude: parsed.latitude, longitude: parsed.longitude, accuracy: null, name: null })
    setCoordInput('')
    setCoordError(null)
    setAddLocationOpen(false)
    setRemoveLocation(false)
    if (isAutoPlaceNameEnabled()) {
      void (async () => {
        const name = await clientReverseGeocode(parsed.latitude, parsed.longitude)
        if (name) setPendingLocation((prev) => (prev ? { ...prev, name } : prev))
      })()
    }
  }

  // 退出编辑态时清理「添加定位」的临时状态（未保存的坐标不保留）
  function resetAddLocation() {
    setPendingLocation(null)
    setAddLocationOpen(false)
    setCoordInput('')
    setCoordError(null)
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/diary/${id}`)
        if (res.status === 404) { router.replace('/diary'); return }
        if (!res.ok) throw new Error('加载失败')
        const { entry } = await res.json() as { entry: Entry }
        setEntry(entry)
        try {
          setPlain(await decryptText(getDek()!, entry.ciphertext, entry.iv))
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
      const body: Record<string, unknown> = { ciphertext, iv, wordCount: plain.trim().length }
      if (pendingLocation) {
        // 原笔记没有坐标、用户在编辑态添加了定位 → 随本次保存一起落库
        body.latitude = pendingLocation.latitude
        body.longitude = pendingLocation.longitude
        body.locationAccuracy = pendingLocation.accuracy
        if (pendingLocation.name) body.locationName = pendingLocation.name
      } else if (removeLocation) {
        // 用户删除位置：显式传 null 覆盖原坐标（diaryUpdateSchema 接受 nullable 字段）
        body.latitude = null
        body.longitude = null
        body.locationAccuracy = null
      }
      const res = await fetch(`/api/diary/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('保存失败')
      const data = await res.json()
      setEntry((prev) => prev ? { ...prev, ...data.entry } : prev)
      setRemoveLocation(false)
      // 清理「添加定位」的临时状态（坐标已落库）
      setPendingLocation(null)
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
  }, [entry, plain, id, removeLocation, pendingLocation])

  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const remove = useCallback(async () => {
    try {
      const res = await fetch(`/api/diary/${id}`, { method: 'DELETE' })
      if (res.status === 401) { router.replace('/login'); return }
      if (res.ok) {
        // IDB 只存草稿（无条目缓存），删除无需清本地
        router.replace('/diary')
        return
      }
      setError('删除失败，请重试')
    } catch {
      setError('删除失败，请重试')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (error && !entry) {
    return (
      <main className="mx-auto flex h-full w-full max-w-md items-center justify-center px-5 safe-pt safe-pb">
        <div className="text-center">
          <p className="text-sm text-neutral-500">{error}</p>
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
  // 展示用坐标：编辑态新添加的（pendingLocation）优先于已保存的
  const shownLat = pendingLocation?.latitude ?? entry.latitude
  const shownLon = pendingLocation?.longitude ?? entry.longitude
  const hasCoords = shownLat != null && shownLon != null
  const shownName = pendingLocation ? pendingLocation.name : entry.locationName
  const displayCoords = shownLat != null && shownLon != null ? `${shownLat.toFixed(6)}, ${shownLon.toFixed(6)}` : ''
  return (
    <main className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col overflow-y-auto px-5 safe-pt safe-pb">
      {/* viewTransitionName：页面切换动画中页头保持固定（空间锚点） */}
      <header className="relative flex items-center justify-between py-3">
        {/* iOS 原生风格返回：chevron 箭头（原生路由返回，右滑手势同样生效）；标题绝对居中。
            字号：‹ 为半角字符视觉偏小（text-3xl），＋ 为全角字符视觉偏大（text-xl）——视觉平衡 */}
        <Link href="/diary" aria-label="返回" scroll={false} className="-ml-1 px-1 text-3xl leading-none text-neutral-400">
          ‹
        </Link>
        <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold">日记</h1>
        {editing ? (
          /* 取消编辑：无改动直接退出；有改动弹确认（丢弃则恢复编辑前内容） */
          <button
            onClick={() => {
              // 无改动（含未保存的「添加定位」）直接退出；否则弹确认
              if (plain === editSnapshotRef.current && !removeLocation && !pendingLocation) {
                setEditing(false)
                resetAddLocation()
                return
              }
              setConfirmCancelEdit(true)
            }}
            className="text-sm text-neutral-400"
          >
            取消
          </button>
        ) : (
          /* 右上角加号：返回首页（新建笔记页） */
          <Link href="/" aria-label="新建笔记" className="text-xl font-light leading-none text-neutral-400 active:opacity-60">
            ＋
          </Link>
        )}
      </header>
      <p className="text-sm tabular-nums text-neutral-400">
        {fmtDate(created)}
        {/* 字数在解密时计算（与编辑器底部"共 x 字"一致：trim 后长度） */}
        {!decryptFailed && <> · {plain.trim().length} 字</>}
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
              disabled={pendingLocation != null}
              className="text-xs tabular-nums text-neutral-400 active:opacity-60 disabled:opacity-60"
            >
              <span className="mr-0.5 text-[10px]">📍</span>
              {/* 有地址信息只显示地址；没有则只显示经纬度（不显示精度） */}
              {shownName ?? displayCoords}
              {/* 已复制提示：跟在地点名/坐标后面 */}
              {coordsCopied && <span className="ml-1.5 text-[10px] font-medium text-emerald-500">已复制坐标</span>}
            </button>
            {/* 保存时记录的实时天气（有则显示，右对齐） */}
            {entry.weather && (
              <span className="shrink-0 text-xs text-neutral-400">{weatherEmoji(entry.weather)}{entry.weather}</span>
            )}
          </div>
          {editing && pendingLocation && (
            <button onClick={resetAddLocation} className="ml-2 text-xs text-neutral-400 underline">
              取消添加的定位
            </button>
          )}
          {editing && !pendingLocation && !removeLocation && (
            <button onClick={() => setRemoveLocation(true)} className="ml-2 text-xs text-red-500 underline">
              移除定位信息
            </button>
          )}
        </div>
      ) : editing ? (
        <div className="mt-1">
          {!addLocationOpen ? (
            <button onClick={() => setAddLocationOpen(true)} className="text-xs text-neutral-400 underline">
              ＋ 添加定位
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
              <button
                onClick={() => void applyCurrentLocation()}
                disabled={locating}
                className="rounded-lg bg-neutral-100 py-2 text-xs text-neutral-700 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-200"
              >
                {locating ? '正在定位…' : '读取当前定位'}
              </button>
              <div className="flex items-center gap-2">
                <input
                  value={coordInput}
                  onChange={(e) => { setCoordInput(e.target.value); setCoordError(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyManualCoords() } }}
                  placeholder="25.049642, 102.676280"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-xs tabular-nums outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                />
                <button
                  onClick={applyManualCoords}
                  disabled={!coordInput.trim()}
                  className="shrink-0 rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-700 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-200"
                >
                  确定
                </button>
              </div>
              <p className="text-[10px] text-neutral-400">粘贴「纬度, 经度」即可，逗号分隔</p>
              {coordError && <p className="text-[10px] text-red-500">{coordError}</p>}
              <button
                onClick={() => { setAddLocationOpen(false); setCoordInput(''); setCoordError(null) }}
                className="self-start text-[10px] text-neutral-400 underline"
              >
                取消
              </button>
            </div>
          )}
        </div>
      ) : null}
      {removeLocation && <p className="mt-1 text-xs text-neutral-400">保存后坐标与地点名将被移除</p>}
      {editing ? (
        <>
          {/* 输入框：flex-1 弹性填充剩余空间（min-h-0 允许收缩）——编辑区完整填满视口 */}
          <textarea
            value={plain}
            onChange={(e) => setPlain(e.target.value)}
            disabled={busy}
            className="mt-3 min-h-0 w-full flex-1 resize-none bg-transparent text-base leading-relaxed outline-none disabled:opacity-60"
          />
          {/* 底部区：整体贴底（上次编辑 + 保存按钮），输入框弹性占中间 */}
          <div className="mt-auto flex flex-col gap-2 pt-2">
            {isEdited && (
              <p className="text-xs tabular-nums text-neutral-400">上次编辑 {fmtDate(editedAt)}</p>
            )}
            <button
              onClick={() => void saveEdit()}
              disabled={busy || !plain.trim()}
              className="w-full rounded-2xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 py-4 font-medium text-white disabled:opacity-50"
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
            <span className="text-xs tabular-nums text-neutral-400">编辑于 {fmtDate(editedAt)}</span>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-6">
            <button
              onClick={() => { editSnapshotRef.current = plain; resetAddLocation(); setEditing(true) }}
              disabled={decryptFailed}
              className="text-sm text-neutral-500 active:opacity-60 disabled:opacity-40"
            >
              编辑
            </button>
            <button
              onClick={() => setConfirmingDelete(true)}
              className="text-sm text-red-500 active:opacity-60"
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
            setRemoveLocation(false)
            resetAddLocation() // 丢弃未保存的坐标
            setEditing(false)
          }}
          onCancel={() => setConfirmCancelEdit(false)}
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
