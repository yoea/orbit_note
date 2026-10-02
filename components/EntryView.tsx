'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ConfirmDialog from '@/components/ConfirmDialog'
import { getDek } from '@/lib/client/session'
import { decryptText, encryptText } from '@/lib/client/crypto/encryption'
import { copyText } from '@/lib/client/clipboard'
import { clientReverseGeocode } from '@/lib/client/geocode'
import { displayLocationName, getPosition, hasStructuredLocation, locationPatch, parseCoords } from '@/lib/client/location'
import { isAutoPlaceNameEnabled, isShowViewsEnabled } from '@/lib/client/prefs'
import { cacheEntriesPage, getCachedEntryById, getQueuedEntryById, removeCachedEntry, removeQueuedEntry, resolveEntryLoad, updateQueuedEntry } from '@/lib/client/offline'
import { weatherEmoji } from '@/lib/client/weather'
import { bumpEntryViewCount } from '@/lib/client/views'
import { playSaveSoundIfEnabled } from '@/lib/client/sound'
import { BRAND_GRADIENT_CLASS, EDITOR_TEXTAREA_CLASS, PRIMARY_BUTTON_CLASS } from '@/lib/client/ui'
import Toast from './Toast'
import Markdown from './Markdown'
import MarkdownBoundary from './MarkdownBoundary'
import MarkdownToolbar from './MarkdownToolbar'
import StarIcon from './StarIcon'
import { countWords } from '@/lib/client/markdown'
import { useMarkdownEditor } from '@/lib/client/use-markdown-editor'

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
  locationProvince: string | null
  locationCity: string | null
  locationDistrict: string | null
  locationName: string | null
  weather: string | null
  timezone: string | null
  starred: boolean
  /** 打开次数（数据库列，POST /api/diary/[id]/view 原子自增） */
  viewCount: number
}

// 打开详情页后停留多久才算一次「打开」：不满这个时长（误触 / 秒退）不计数、不发请求。
// 界面先按 entry.viewCount 原样显示（0 就显示 0），到点后数字才原地跳到 +1。
const VIEW_COUNT_DELAY_MS = 1_000

// 日记详情视图（原生路由页 /entry/[id] 渲染；DEK 会话级持久化，导航/重载自动恢复）
export default function EntryView({ id }: { id: string }) {
  const router = useRouter()
  const [entry, setEntry] = useState<Entry | null>(null)
  const [plain, setPlain] = useState('') // 解密后的正文，现在承载的是 Markdown 源码
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 「打不开」的两种明确原因（见 resolveEntryLoad）：以前这两种都走静默 router.replace('/diary')，
  // 用户只觉得「点了没反应」。现在各自渲染说明页 + 诊断码，便于用户反馈与线上归因。
  const [miss, setMiss] = useState<'deleted' | 'offline-missing' | null>(null)
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
  // 「打开次数」：**数据库列**（见 lib/client/views.ts）。不再另设 state——直接渲染
  // entry.viewCount（bump 响应会整行合并进 entry），消除「初始 0 → 突然跳到 N」的中间帧。
  const viewCountedRef = useRef(false)
  // 组件是否仍挂载：延迟计数在 1 秒后才触发，期间用户可能已离开本页。
  // ★ 不用「effect cleanup + clearTimeout」实现「离开就不计」——StrictMode（仅开发模式）
  //   会假卸载一次，而 viewCountedRef 又挡住重挂载后的重新武装，那样开发模式会永远数不上；
  //   aliveRef 双挂载后仍为 true（setup 会再跑一次），只有**真离开**才变 false。
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])
  // 打开次数是否显示（偏好 qo-show-views，默认开）。用惰性初值同步读取：
  // 本组件是客户端组件、偏好读取无异步时序，首帧即为真值（与 isAutoPlaceNameEnabled
  // 在 effect 里读不同——那是「用的时候才读」，这里是渲染条件，必须首帧正确）。
  const [showViews] = useState(() => isShowViewsEnabled())
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

  // Markdown 工具条 + 预览切换（编辑态专属）。
  // 与写页 DiaryEditor 共用同一份接线与横条组件——此前详情页编辑态整条工具条都缺失，
  // 编辑已有笔记时既不能插标记也不能先预览，与新建笔记页明显不一致。
  // 复位预览态用 resetPreview()（不是 setPreview(false)）：它同时丢弃位置快照，
  // 避免下一次进编辑态时用上一次预览留下的陈旧滚动位置。
  const { editorRef, previewRef, preview, resetPreview, togglePreview, applyToolbar } = useMarkdownEditor({
    text: plain,
    applyText: setPlain,
  })

  // 复制坐标到剪贴板并提示；无地点名时顺带查询一次（已有地名不重复查询，失败静默保持坐标）
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
    if (!hasStructuredLocation(entry) && !entry.locationName) {
      void (async () => {
        try {
          // 客户端直调反查（大陆可达、CORS 开放），成功后 PATCH 存库并更新界面。
          // 写的是**结构化三级**（省/市/区），服务端会顺手清掉旧的单一地名串。
          const parts = await clientReverseGeocode(lat, lon)
          if (parts) await persistLocation(locationPatch(parts))
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

  // 地点名异步反查并补写（尽力而为）：失败静默——详情页的自动补查与点击坐标都能兜底。
  // 写的是结构化三级（省/市/区）。
  function backfillPlace(latitude: number, longitude: number) {
    if (!isAutoPlaceNameEnabled()) return
    void (async () => {
      const parts = await clientReverseGeocode(latitude, longitude)
      if (!parts) return
      try { await persistLocation(locationPatch(parts)) } catch { /* 忽略 */ }
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
      backfillPlace(latitude, longitude)
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
      backfillPlace(parsed.latitude, parsed.longitude)
    } catch {
      setCoordError('保存位置失败，请重试')
    } finally {
      setSavingLocation(false)
    }
  }

  // 移除定位：立即生效且不可逆，调用前由 UI 二次确认。
  // 服务端在 latitude 为 null 时会把地名（结构化三级 + 旧的单一串）一并清空。
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
        setMiss(null)
        const dek = getDek()
        if (!dek) throw new Error('未解锁')
        const res = await fetch(`/api/diary/${id}`).catch(() => null)
        // 未同步笔记（离线新增、尚未上传）：服务器上还没有这条，但列表里可见可点开
        const queued = await getQueuedEntryById(id)
        // 服务器给出 200 时不需要读本地缓存（少一次 IndexedDB 往返）；其余情形都要读
        const cached = res?.status === 200 ? null : await getCachedEntryById(id)
        // 数据来源判定统一走纯函数（真值表见 tests/entry-load.test.ts）：
        // 五种情形各自有名字，组件只负责渲染——**不再有静默跳转**那条路径。
        const plan = resolveEntryLoad({
          serverStatus: res ? res.status : null,
          hasQueued: queued !== null,
          hasCached: cached !== null,
        })
        if (plan.kind === 'error') throw new Error('加载失败')
        if (plan.kind === 'deleted' || plan.kind === 'offline-missing') {
          // ★ 原来这里是 `if (!loaded) { router.replace('/diary'); return }`——静默跳回列表，
          // 用户看到的就是「点击没反应、无法查看」，而服务端日志里什么都没有，线上无法归因。
          // 现在显式渲染一个说明页（含诊断码），把「为什么打不开」直接告诉用户。
          setMiss(plan.kind)
          return
        }
        const loaded: Entry = plan.kind === 'server'
          ? ((await res!.json()) as { entry: Entry }).entry
          : plan.kind === 'local-queue' ? queued! : cached!
        setServerBacked(plan.kind === 'server')
        setPendingSync(queued !== null)
        // 网络不可达且数据来自本地缓存（非未同步笔记）→ 离线只读（PATCH/DELETE 发不出去）
        setLocalReadonly(res === null && queued === null)
        setEntry(loaded)
        // ★ 必须 await：与列表页同一条不变量——**能被读到的条目，本地必须已有密文**。
        // 原文是 `void cacheEntriesPage([entry])`，写完之前就断网/被 iOS 挂起，这条就永远
        // 没进缓存，之后离线点开它只会「没反应」。
        if (plan.kind === 'server') await cacheEntriesPage([loaded])
        try {
          setPlain(await decryptText(dek, loaded.ciphertext, loaded.iv))
          setDecryptFailed(false)
        } catch {
          setPlain('(解密失败，数据可能已损坏)')
          setDecryptFailed(true)
        }
      } catch {
        setError('连接失败，请检查网络后重试')
      }
    })()
    // 依赖只有 id：本 effect 内引用的其它东西都是模块级函数或 setState（引用稳定），
    // 不需要 eslint-disable 抑制 exhaustive-deps（原先抑制是因为里面用了 router）。
  }, [id])

  // 「打开次数」+1：服务器**原子自增**（POST /api/diary/[id]/view），见 lib/client/views.ts。
  // ★ 四条约束：
  //   1) 只在**正文真正就位**后计（entry 有值）——「打不开」的说明页不算看过；
  //   2) **停留满 1 秒才计**（2026-10-01 定）：误触 / 秒退不算「打开过」，也省一次写请求。
  //      数字先以 entry.viewCount 原样显示（0 就显示 0），1 秒后响应回来才原地跳到 +1；
  //   3) viewCountedRef 去重：React 开发模式（StrictMode）会双挂载 effect，
  //      不去重的话每打开一次会 +2；同一篇上的后续 setEntry（改定位 / 收藏 / 编辑保存）
  //      也会让本 effect 重跑，同样靠它挡住；
  //   4) 数不成立刻返回，绝不报错、绝不重试——它只是个装饰性数字，不能影响阅读或保存。
  useEffect(() => {
    if (!entry || viewCountedRef.current) return
    viewCountedRef.current = true
    // 队列里的条目（离线新增、尚未上传）服务器上还不存在 ⇒ 自增必然 404，直接跳过。
    // 离线打开任何一篇都不计数（见 views.ts 的取舍说明），不是这里漏了。
    if (pendingSync) return
    // 1 秒内离开（返回 / 误触）：回调里查 aliveRef，请求都不发。
    // ⚠️ 刻意不在本 effect 的 cleanup 里 clearTimeout——见 aliveRef 声明处的说明。
    setTimeout(() => {
      if (!aliveRef.current) return
      void bumpEntryViewCount(entry.id).then((updated) => {
        if (!updated) return // 离线 / 限流 / 已删除：静默，保持当前显示
        setEntry((prev) => (prev ? { ...prev, ...updated } : prev))
        // 本地密文缓存同步更新：否则下次离线打开这一篇会读到 +1 之前的旧值
        void cacheEntriesPage([updated])
      })
    }, VIEW_COUNT_DELAY_MS)
  }, [entry, pendingSync])

  // 打开详情页自动补地名：有坐标但**没有结构化地名** → 反查 → PATCH 存库 + 更新界面。
  // 受「自动补全地点名」开关控制（关闭后不自动外发坐标，点击坐标仍可手动查询）。
  // 发送前坐标会被模糊到约 1km（见 geocode.ts 的 coarsenCoordinate）。
  // 同一篇每次加载只自动尝试一次；失败写 30 分钟冷却，避免反复打第三方接口。
  //
  // ★ 触发条件是「没有结构化三级」而不是「没有地名」：老数据只有那个「区 市」的单一串
  //   （分不出省/市/区，也就没法按省/市筛选）。这样**老条目在被打开时自动升级**成结构化，
  //   不必一次性回填（旧串里根本没有省的信息，猜出来的结构只会是错的）。
  //   代价：老条目会在首次打开时多打一次反查（仍受上面的开关与坐标模糊约束）。
  useEffect(() => {
    if (!entry) return
    const entryId = entry.id
    const latitude = entry.latitude
    const longitude = entry.longitude
    if (latitude == null || longitude == null || hasStructuredLocation(entry)) return
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
        const parts = await clientReverseGeocode(latitude, longitude)
        if (!parts) {
          try { sessionStorage.setItem(cooldownKey, String(Date.now())) } catch { /* 忽略 */ }
          return
        }
        await fetch(`/api/diary/${entryId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(locationPatch(parts)),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data: { entry?: Entry } | null) => {
            // 以服务端返回为准（它同时清掉了旧的单一地名串），别自己拼状态
            if (data?.entry) setEntry((prev) => (prev && prev.id === entryId ? { ...prev, ...data.entry } : prev))
          })
        try { sessionStorage.removeItem(cooldownKey) } catch { /* 忽略 */ }
      } catch {
        try { sessionStorage.setItem(cooldownKey, String(Date.now())) } catch { /* 忽略 */ }
      }
    })()
  }, [entry])

  const saveEdit = useCallback(async () => {
    if (!entry || !plain.trim()) return
    // 无改动拦截（必须在 setBusy 之前，否则会先闪一下「保存中…」）：
    // 正文与「进入编辑态时的快照」逐字符相同 ⇒ 没有任何要写的东西，
    // 直接退出编辑态、**不发任何请求**。
    // 不请求就不会碰 updatedAt —— 服务端只在 PATCH 带 ciphertext 时才更新它
    // （app/api/diary/[id]/route.ts），所以「拦住保存」等价于「编辑时间不变」。
    // 判据用严格相等，且与右上角「取消」按钮共用同一个快照（editSnapshotRef）：
    // 保存的就是原文，客户端与服务端都不做 trim / 规范化 ⇒ 首尾空白、换行、空格的
    // 任何差异都属于真实改动，必须放行——不能"宽容"地判为无改动，否则会静默吞掉修改。
    if (plain === editSnapshotRef.current) {
      setAddLocationOpen(false)
      setCoordInput('')
      setCoordError(null)
      setEditing(false)
      return
    }
    setBusy(true)
    try {
      const dek = getDek()!
      const { ciphertext, iv } = await encryptText(dek, plain)
      const wordCount = countWords(plain)
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
        playSaveSoundIfEnabled()
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
      playSaveSoundIfEnabled()
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

  // —— 收藏（星标）——
  // 只改元数据：PATCH 不带 ciphertext ⇒ 服务端不更新 updatedAt ⇒ 收藏一篇**不算编辑**，
  // 详情页不会因此多出一行「编辑于」（与定位改动同一条约定）。
  const [starBusy, setStarBusy] = useState(false)

  async function toggleStar() {
    if (!entry || starBusy) return
    const next = !entry.starred
    setStarBusy(true)
    // 乐观更新：纯展示状态，等一个往返才变色会显得「点了没反应」
    setEntry((prev) => (prev ? { ...prev, starred: next } : prev))
    try {
      if (pendingSync) {
        // 还没上服务器的笔记：收藏写进本地写队列，联网补传时一起带上
        //（否则服务端会用默认值 false 把它抹掉——见 lib/client/offline.ts 的 QueuedEntry.starred）
        const ok = await updateQueuedEntry(id, { starred: next })
        if (!ok) throw new Error('保存失败')
      } else {
        const res = await fetch(`/api/diary/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ starred: next }),
        })
        if (!res.ok) throw new Error('保存失败')
        const data = await res.json() as { entry: Entry }
        // 本地密文缓存同步更新：否则离线（读缓存）看到的还是改之前的收藏态
        void cacheEntriesPage([data.entry])
        setEntry((prev) => (prev ? { ...prev, ...data.entry } : prev))
      }
    } catch {
      setEntry((prev) => (prev ? { ...prev, starred: !next } : prev)) // 失败回滚，不留假状态
      setError('收藏失败，请重试')
    } finally {
      setStarBusy(false)
    }
  }

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
      <main className="mx-auto flex h-full w-full max-w-md items-center justify-center px-5">
        <div className="text-center">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{error}</p>
          <button onClick={() => window.location.reload()} className="mt-4 rounded-xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-6 py-3 text-sm font-medium text-white">重试</button>
        </div>
      </main>
    )
  }

  // ★ 打不开时的明确说明（替代原来的静默跳回列表）。
  // 文案刻意解释「为什么」与「怎么办」：离线缺缓存是**可以自愈**的（联网打开一次即可），
  // 「不在了」则不可逆——两者混在一起只会让用户以为是同一个 bug。
  // 诊断码与登录页的「诊断 no-dek」、error.tsx 的「诊断码」同风格：只有类别，不含任何内容信息。
  if (miss) {
    return (
      <main className="mx-auto flex h-full w-full max-w-md flex-col items-center justify-center gap-3 px-5">
        <p className="text-base font-medium text-neutral-800 dark:text-neutral-100">
          {miss === 'deleted' ? '这篇日记不在了' : '这篇还没缓存到本机'}
        </p>
        <p className="max-w-xs text-center text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
          {miss === 'deleted'
            ? '服务器上已经没有这篇日记（可能在其他设备上删除过）。'
            : '现在连不上服务器，本机也没有这篇的离线副本。联网后打开一次，它就会缓存下来，之后离线也能读。'}
        </p>
        <Link
          href="/diary"
          className="mt-1 rounded-xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-6 py-3 text-sm font-medium text-white active:opacity-90"
        >
          返回列表
        </Link>
        <p className="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400">
          诊断 {miss === 'deleted' ? 'notfound' : 'nocache'}
        </p>
      </main>
    )
  }

  if (!entry) return <main className="mx-auto h-full w-full max-w-md overflow-y-auto px-5" />

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
  // 地名展示口径：结构化三级优先、老数据回退单一串（与列表页/搜索共用同一个函数）
  const placeName = displayLocationName(entry)
  const locationBusy = locating || savingLocation
  return (
    <main className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col overflow-y-auto px-5">
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
        {!decryptFailed && <> · {countWords(plain)} 字</>}
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
          <div className="flex items-center justify-between gap-2">
            {/* 定位（点击复制坐标）+ 编辑态紧随其后的移除小按钮，合成一组、保持左对齐 */}
            <div className="flex min-w-0 items-center gap-1">
              {/* 点击复制精确坐标（有地址时复制坐标；无地址时同时触发地点补查） */}
              <button
                onClick={() => void copyCoords()}
                className="min-w-0 truncate text-xs tabular-nums text-neutral-500 dark:text-neutral-400 active:opacity-60"
              >
                <span className="mr-0.5 text-[10px]">📍</span>
                {/* 有地址信息只显示地址；没有则只显示经纬度（不显示精度） */}
                {placeName ?? displayCoords}
                {/* 已复制提示：跟在地点名/坐标后面 */}
                {coordsCopied && <span className="ml-1.5 text-[10px] font-medium text-emerald-500">已复制坐标</span>}
              </button>
              {/* 移除定位：**小小的图标按钮，紧跟地点名之后**（原先是一条下划线文字、独占一行，太重）。
                  未同步笔记不提供：定位走服务端 PATCH，而这条还没上服务器。
                  移除不可逆 ⇒ 点击后仍走 ConfirmDialog 二次确认。 */}
              {editing && !pendingSync && (
                <button
                  onClick={() => setConfirmRemoveLocation(true)}
                  disabled={locationBusy}
                  aria-label="移除定位"
                  title="移除定位"
                  className="shrink-0 rounded-full p-1 text-neutral-500 transition-colors active:bg-neutral-100 active:opacity-60 disabled:opacity-50 dark:text-neutral-400 dark:active:bg-neutral-800"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
            {/* 保存时记录的实时天气（有则显示，右对齐） */}
            {entry.weather && (
              <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{weatherEmoji(entry.weather)}{entry.weather}</span>
            )}
          </div>
        </div>
      ) : editing && !pendingSync ? (
        <div className="mt-1">
          {!addLocationOpen ? (
            <button onClick={() => setAddLocationOpen(true)} className="text-xs text-neutral-500 dark:text-neutral-400 underline">
              ＋ 添加定位
            </button>
          ) : (
            /* 添加定位面板：与全站同一套语言——主操作吃品牌渐变、次要操作用描边；
               关闭按钮移到**标题行右上角**（原先是一条下划线「取消」孤立在面板最底部，
               既白占一行高度，又在浅色下几乎看不见）。
               面板本身不再套灰底：384px 宽的窄栏里叠底色只会更碎，靠边框 + 标题行分区即可。 */
            <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium text-neutral-700 dark:text-neutral-200">添加定位</p>
                <button
                  onClick={closeAddLocation}
                  aria-label="关闭"
                  className="-mr-1 -mt-1 shrink-0 rounded-full p-1 text-neutral-500 transition-colors active:bg-neutral-100 active:opacity-60 dark:text-neutral-400 dark:active:bg-neutral-800"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <button
                onClick={() => void applyCurrentLocation()}
                disabled={locationBusy}
                className={`w-full rounded-lg py-2 text-xs font-medium text-white transition-colors active:scale-[0.99] disabled:opacity-50 ${BRAND_GRADIENT_CLASS}`}
              >
                {locating ? '正在定位…' : savingLocation ? '正在保存…' : '读取当前定位'}
              </button>
              <div className="mt-2 flex items-center gap-2">
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
                  className="shrink-0 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-700 active:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:active:bg-neutral-800"
                >
                  确定
                </button>
              </div>
              <p className="mt-2 text-[10px] text-neutral-500 dark:text-neutral-400">粘贴「纬度, 经度」即可，确定后立即保存</p>
              {coordError && <p className="mt-1 text-[10px] text-red-500">{coordError}</p>}
            </div>
          )}
        </div>
      ) : null}
      {editing ? (
        <>
          {/* Markdown 工具条：放在**编辑区顶部**（输入框/预览区之上）。
              原先在输入框下方——手机输入时键盘从底部弹出会把整条盖住，工具条等于不可用
              （2026-09-30 用户反馈）。与写页共用同一份组件，两页位置一致。
              预览态隐藏动作按钮但保留这一行，按钮位置不跳动。 */}
          <MarkdownToolbar
            preview={preview}
            disabled={busy}
            onAction={applyToolbar}
            onTogglePreview={togglePreview}
          />
          {/* 编辑区：flex-1 弹性填充剩余空间（min-h-0 允许收缩）——编辑区完整填满视口。
              预览态换成渲染结果（只读，不改 plain）——与写页「预览」同一套交互。
              输入框字号/行高来自 EDITOR_TEXTAREA_CLASS，与写页 AutoTextarea 同源
              （text-base = 查看页 qo-markdown 容器）——编辑与查看必须逐行对齐。
              上下不再写 mt-3：上间距由工具条的 mb-2 承担，下间距由底部区承担。 */}
          {preview ? (
            <div ref={previewRef} className="min-h-0 flex-1 overflow-y-auto">
              {plain.trim()
                ? <MarkdownBoundary source={plain}><Markdown source={plain} /></MarkdownBoundary>
                : <p className="text-sm text-neutral-500 dark:text-neutral-400">还没有内容</p>}
            </div>
          ) : (
            <textarea
              ref={editorRef}
              value={plain}
              onChange={(e) => setPlain(e.target.value)}
              disabled={busy}
              className={EDITOR_TEXTAREA_CLASS}
            />
          )}
          {/* 底部区：整体贴底（上次编辑 + 保存按钮），输入框弹性占中间。
              必须有下内边距：main 自身没有 pb，而 TabBar 就紧贴在它下方（(app)/layout 里
              两者是相邻的兄弟节点，中间没有任何间隔）——少了这段留白，渐变实心按钮的下边缘
              会正好压在 TabBar 的 1px 上边框上，视觉上就是「按钮与 TabBar 重叠」。
              查看态没这问题，只因那条操作栏自带 py-4。
              取 16px（pb-4）与查看态操作栏的下内边距一致；底部安全区仍由 TabBar 的
              pb-safe 承担，这里不能写 safe-pb（否则叠出双份留白）。 */}
          <div className="mt-auto flex flex-col gap-2 pb-4 pt-2">
            {isEdited && (
              /* 与查看态的「编辑于」同一档字号（11px）：两处指的是同一个时间戳，
                 不该一个 12px 一个 11px（用户要求日期再小一档）。 */
              <p className="text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">上次编辑 {fmtDate(editedAt)}</p>
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
          {/* 正文：Markdown 源码交给共享渲染器（与编辑器预览、列表派生逻辑同源）。
              改造前是 plain.split('\n').map → 每行一个 <p>；现在换行由 remark-breaks
              处理成 <br>，段间距只出现在真正的空行分隔处。
              外面包一层 MarkdownBoundary：渲染器异常时退化成「原文可读」，
              绝不让一篇笔记因为格式解析失败而变成「打不开」（见该组件注释）。 */}
          <MarkdownBoundary source={plain}>
            <Markdown source={plain} className="mt-4" />
          </MarkdownBoundary>
        </>
      )}
      {decryptFailed && (
        <p className="mt-3 text-sm text-red-500">原内容无法解密，无法编辑，否则将覆盖原数据</p>
      )}
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      {!editing && (
        <>
          {/* 底部行：「编辑于」钉在分割线**正上方**（用户要求），不再跟着正文一起往上浮。
              ★ `mt-auto` 吃掉剩余空间 —— 正文短时它被压到底部，正文长时它自然接在正文之后，
                两种情况下它与分割线之间都只有这一段留白。
              ★ 容器**恒渲染**、只有内容是条件渲染：这段留白原先挂在「内容尾行」上，若跟着
                「编辑于」一起变成条件渲染，**没编辑过的条目**正文末行又会贴住分割线
                （Markdown.tsx 的段落是 `mb-3 last:mb-0`，末段没有下边距 ⇒ 间隙 0px）。
              ★ 字号再降一档到 11px：它是三级信息，不该与正文同级。 */}
          <div className="mt-auto pt-8 pb-3">
            {isEdited && (
              <p className="text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                编辑于 {fmtDate(editedAt)}
              </p>
            )}
          </div>

          {/* 底部操作栏：一行 **4 个图标**（用户指定的布局）——
              左组 = 这一篇的**状态**（打开次数 → 收藏），右组 = 对这个**页面**的操作（编辑 / 删除）。
              · 打开次数从内容尾行搬到这里、排在收藏**前面**（用户要求「排在最前」）；
                眼睛图标由 14px 提到 18px、strokeWidth 2，与星 / 编辑 / 删除**同一套图标语言**
                （原先它 14px 且配 12px 数字，视觉上属于另一档）。
              · 收藏**去掉了文字标签**（用户要求）：状态只由星形本身表达（实心 = 已收藏，
                描边 = 未收藏）。可访问性由 aria-pressed / aria-label / title 保住，
                桌面端仍有 tooltip（移动端无 hover，图标状态就是唯一信号）。
              · 左组 `-ml-2` / 右组 `-mr-2`：各自抵消子项的 p-2，让首尾图标与正文左右边缘对齐。
              · 收藏 / 编辑 / 删除在「断网且条目来自云端缓存」时禁用（请求发不出去）；
                打开次数不是操作，永远只读。未同步笔记走本地写队列，不受此限。 */}
          <div className="flex items-center justify-between border-t border-neutral-100 py-4 dark:border-neutral-800">
            <div className="-ml-2 flex items-center gap-1">
              {/* 打开次数：受偏好 qo-show-views 控制（默认开）。
                  ★ 只隐藏「显示」，计数本身照常——bumpEntryViewCount 照常上报，
                  与本行渲染无关（关掉显示不等于停止统计）。
                  ★ 恒渲染（含 0 次，2026-10-01 定）：此前 `viewCount > 0` 的条件渲染让
                  「0 次的文章首次打开」在计数返回后图标才凭空插入 DOM = 布局闪现；
                  现在图标恒在，数字只是原地跳变（0 → 1）。 */}
              {showViews && (
                <span
                  role="img"
                  aria-label={`打开过 ${entry.viewCount} 次`}
                  title={`打开过 ${entry.viewCount} 次`}
                  className="flex items-center gap-1.5 p-2 text-sm tabular-nums text-neutral-500 dark:text-neutral-400"
                >
                  {/* 眼睛图标：18px + strokeWidth 2，与星、编辑、删除统一 */}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] shrink-0" aria-hidden>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span aria-hidden="true">{entry.viewCount}</span>
                </span>
              )}
              <button
                onClick={() => void toggleStar()}
                disabled={starBusy || (localReadonly && !pendingSync)}
                aria-pressed={entry.starred}
                aria-label={entry.starred ? '取消收藏' : '收藏'}
                title={entry.starred ? '取消收藏' : '收藏'}
                className="rounded-full p-2 text-neutral-500 transition-colors active:bg-neutral-100 active:opacity-60 disabled:opacity-40 dark:text-neutral-400 dark:active:bg-neutral-800"
              >
                {/* 暖色 Q 版五角星：实心=已收藏，描边=未收藏（同一颗星的两个状态，不用两套图形）。
                    刻意**不带文字**——用户要求「仅通过图标状态变化表示收藏状态」。 */}
                <StarIcon filled={entry.starred} className="h-[18px] w-[18px]" />
              </button>
            </div>
            <div className="-mr-2 flex items-center gap-1">
              {/* 编辑 / 删除：**图标按钮**（原先是「编辑」「删除」两段文字，删除还用了 text-red-500，
                  在查看页底部过于抢眼）。降权三招：去文字、改图标、删除不再用红色
                  ——破坏性由点击后的 ConfirmDialog 二次确认承担，不必靠颜色预警。
                  图标 18px + 中性色，与页面其它次级元素同级；aria-label/title 保住
                  可访问性与桌面端 tooltip（移动端无 hover）。
                  离线只读：云端缓存条目在断网时不可编辑/删除（PATCH/DELETE 发不出去，
                  硬点只会「保存失败」）。未同步笔记（pendingSync）不受限——编辑/删除
                  都在本地队列完成。 */}
              <button
                onClick={() => { editSnapshotRef.current = plain; closeAddLocation(); resetPreview(); setEditing(true) }}
                disabled={decryptFailed || (localReadonly && !pendingSync)}
                aria-label="编辑"
                title="编辑"
                className="rounded-full p-2 text-neutral-500 transition-colors active:bg-neutral-100 active:opacity-60 disabled:opacity-40 dark:text-neutral-400 dark:active:bg-neutral-800"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden>
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
              <button
                onClick={() => setConfirmingDelete(true)}
                disabled={localReadonly && !pendingSync}
                aria-label="删除"
                title="删除"
                className="rounded-full p-2 text-neutral-500 transition-colors active:bg-neutral-100 active:opacity-60 disabled:opacity-40 dark:text-neutral-400 dark:active:bg-neutral-800"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden>
                  <path d="M3 6h18" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          </div>
        </>
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
