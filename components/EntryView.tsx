'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getDek } from '@/lib/client/session'
import { decryptText, encryptText } from '@/lib/client/crypto/encryption'
import { copyText } from '@/lib/client/clipboard'

interface Entry {
  id: string
  ciphertext: string
  iv: string
  createdAt: string
  updatedAt: string
  latitude: number | null
  longitude: number | null
  locationAccuracy: number | null
  timezone: string | null
}

// 日记详情视图（首页状态机内切换，避免 PWA 导航重载导致解锁状态丢失）
export default function EntryView({ id, onBack }: { id: string; onBack: () => void }) {
  const router = useRouter()
  const [entry, setEntry] = useState<Entry | null>(null)
  const [plain, setPlain] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [decryptFailed, setDecryptFailed] = useState(false)
  const [coordsCopied, setCoordsCopied] = useState(false)
  const [removeLocation, setRemoveLocation] = useState(false)
  const coordsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 复制坐标到剪贴板并提示
  async function copyCoords() {
    if (entry?.latitude == null || entry.longitude == null) return
    const ok = await copyText(`${entry.latitude.toFixed(6)}, ${entry.longitude.toFixed(6)}`)
    if (ok) {
      setCoordsCopied(true)
      if (coordsTimerRef.current) clearTimeout(coordsTimerRef.current)
      coordsTimerRef.current = setTimeout(() => setCoordsCopied(false), 2000)
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/diary/${id}`)
        if (res.status === 404) { onBack(); return }
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

  const saveEdit = useCallback(async () => {
    if (!entry || !plain.trim()) return
    setBusy(true)
    try {
      const dek = getDek()!
      const { ciphertext, iv } = await encryptText(dek, plain)
      const body: Record<string, unknown> = { ciphertext, iv }
      // 用户删除位置：显式传 null 覆盖原坐标（diaryUpdateSchema 接受 nullable 字段）
      if (removeLocation) {
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
      setError(null)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }, [entry, plain, id, removeLocation])

  const remove = useCallback(async () => {
    if (!window.confirm('确定删除这篇日记吗？删除后无法恢复。')) return
    try {
      const res = await fetch(`/api/diary/${id}`, { method: 'DELETE' })
      if (res.status === 401) { router.replace('/login'); return }
      if (res.ok) {
        // IDB 只存草稿（无条目缓存），删除无需清本地
        onBack()
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
      <main className="flex min-h-dvh items-center justify-center px-5 safe-pt safe-pb">
        <div className="text-center">
          <p className="text-sm text-neutral-500">{error}</p>
          <button onClick={() => window.location.reload()} className="mt-4 rounded-xl bg-neutral-900 px-6 py-3 text-sm font-medium text-white">重试</button>
        </div>
      </main>
    )
  }

  if (!entry) return <main className="min-h-dvh px-5 safe-pt" />

  const created = new Date(entry.createdAt)
  return (
    <main className="min-h-dvh px-5 safe-pt safe-pb">
      <header className="flex items-center justify-between py-3">
        {/* iOS 原生风格返回：chevron 箭头 */}
        <button onClick={onBack} aria-label="返回" className="-ml-1 px-1 text-2xl leading-none text-neutral-400">
          ‹
        </button>
        <h1 className="text-lg font-semibold">日记</h1>
        <button onClick={() => setEditing(!editing)} disabled={decryptFailed} className="text-sm text-neutral-400 disabled:opacity-50">
          {editing ? '取消' : '编辑'}
        </button>
      </header>
      <p className="text-sm tabular-nums text-neutral-400">
        {created.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}{' '}
        {created.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
      </p>
      {entry.latitude != null && entry.longitude != null && !editing && (
        <div className="mt-1">
          {/* 直接显示坐标，点击复制 */}
          <button
            onClick={() => void copyCoords()}
            className="text-xs tabular-nums text-neutral-400 underline active:opacity-60"
          >
            {entry.latitude.toFixed(6)}, {entry.longitude.toFixed(6)}
            {entry.locationAccuracy != null && ` · ±${Math.round(entry.locationAccuracy)} 米`}
          </button>
          {coordsCopied && <p className="mt-0.5 text-xs text-neutral-400">已复制坐标</p>}
        </div>
      )}
      {editing ? (
        <>
          <textarea
            value={plain}
            onChange={(e) => setPlain(e.target.value)}
            disabled={busy}
            className="mt-3 min-h-[50dvh] w-full resize-none bg-transparent text-lg leading-relaxed outline-none disabled:opacity-60"
          />
          {entry.latitude != null && entry.longitude != null && !removeLocation && (
            <div className="mt-2 flex items-center gap-3">
              <p className="text-xs tabular-nums text-neutral-400">
                {entry.latitude.toFixed(6)}, {entry.longitude.toFixed(6)}
              </p>
              <button onClick={() => setRemoveLocation(true)} className="text-xs text-red-500 underline">删除位置</button>
            </div>
          )}
          {removeLocation && <p className="mt-2 text-xs text-neutral-400">保存后位置将被删除</p>}
          <button
            onClick={() => void saveEdit()}
            disabled={busy || !plain.trim()}
            className="mt-4 w-full rounded-2xl bg-neutral-900 py-4 font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {busy ? '保存中…' : '保存修改'}
          </button>
        </>
      ) : (
        // 正文：小一号字体（text-base）+ 每行分段加段间距（单换行也有明显间距；空行自然形成更大间隔）
        <div className="mt-4 text-base leading-relaxed text-neutral-800 dark:text-neutral-200">
          {plain.split('\n').map((line, i) => (
            <p key={i} className="mb-2 whitespace-pre-wrap last:mb-0">{line}</p>
          ))}
        </div>
      )}
      {decryptFailed && (
        <p className="mt-3 text-sm text-red-500">原内容无法解密，无法编辑，否则将覆盖原数据</p>
      )}
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      {!editing && (
        <button
          onClick={() => void remove()}
          className="mt-10 w-full rounded-2xl border border-red-200 py-3 text-sm text-red-500 dark:border-red-900"
        >
          删除日记
        </button>
      )}
    </main>
  )
}
