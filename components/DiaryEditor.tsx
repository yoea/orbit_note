'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import AutoTextarea from './AutoTextarea'
import { getDek } from '@/lib/client/session'
import { decryptText, encryptText } from '@/lib/client/crypto/encryption'
import { getPosition } from '@/lib/client/location'
import { clearLocalDraft, fetchServerDraft, loadLocalDraft, pickNewer, pushServerDraft, saveLocalDraft } from '@/lib/client/draft-sync'

export default function DiaryEditor() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [savedTime, setSavedTime] = useState('')
  const [showDraftBanner, setShowDraftBanner] = useState(false)
  const [showLocationNotice, setShowLocationNotice] = useState(false)
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

  // 键盘遮挡防护：visualViewport resize 时把活动元素滚入视野
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      const el = document.activeElement
      if (el instanceof HTMLTextAreaElement) {
        el.scrollIntoView({ block: 'center' })
        el.style.maxHeight = `${vv.height - 120}px`
      }
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [])

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

  // 首次定位权限说明（仅一次，sessionStorage 标记）：权限仍为 prompt（未授权）时提示保存日记会记录位置
  useEffect(() => {
    void (async () => {
      try {
        if (sessionStorage.getItem('qo-location-notice-shown')) return
        if (typeof navigator !== 'undefined' && navigator.permissions) {
          const status = await navigator.permissions.query({ name: 'geolocation' })
          if (status.state === 'prompt') {
            setShowLocationNotice(true)
            sessionStorage.setItem('qo-location-notice-shown', '1')
          }
        }
      } catch { /* 权限 API 不可用则不显示 */ }
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
      const loc = await getPosition(2000)
      const { ciphertext, iv } = await encryptText(dek, body)
      const res = await fetch('/api/diary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ciphertext, iv, encryptionVersion: 1,
          latitude: loc?.latitude ?? null,
          longitude: loc?.longitude ?? null,
          locationAccuracy: loc?.accuracy ?? null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      })
      if (!res.ok) throw new Error('save failed')
      // 保存成功：取消未决防抖并作废进行中的冲刷，防止草稿"复活"
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
      draftEpochRef.current++
      await fetch('/api/draft', { method: 'DELETE' }).catch(() => {})
      await clearLocalDraft()
      const now = new Date()
      setSavedTime(now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }))
      setStatus('saved')
      setText(''); textRef.current = ''
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current)
      statusTimeoutRef.current = setTimeout(() => setStatus('idle'), 3000)
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="flex min-h-dvh flex-col px-5 safe-pt safe-pb">
      <header className="flex items-center justify-between py-3">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">我的日记</h1>
        <nav className="flex items-center gap-4">
          <a href="/history" className="text-sm text-neutral-400">历史</a>
          <a href="/settings" className="text-sm text-neutral-400">设置</a>
        </nav>
      </header>
      {showDraftBanner && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">发现上次未完成的日记</p>
          <div className="mt-2 flex gap-3">
            <button onClick={() => void restoreDraft()} className="text-sm font-medium text-amber-800 underline dark:text-amber-200">恢复草稿</button>
            <button onClick={() => void discardDraft()} className="text-sm text-amber-700 dark:text-amber-300">放弃草稿</button>
          </div>
        </div>
      )}
      <AutoTextarea
        value={text}
        onChange={(v) => { setText(v); textRef.current = v; onDraftChange(v) }}
        placeholder="写下此刻……"
        autoFocus
        disabled={status === 'saving'}
      />
      {showLocationNotice && (
        <p className="text-xs text-neutral-400">保存日记时记录当前位置，仅用于记录你当时在哪里。</p>
      )}
      <footer className="flex items-center justify-between py-4 pb-safe">
        <p className="text-sm text-neutral-400">
          {status === 'saving' && '正在保存…'}
          {status === 'saved' && `已保存 · ${savedTime}`}
          {status === 'error' && '保存失败，请重试'}
        </p>
        <button
          onClick={() => void save()}
          disabled={!text.trim() || status === 'saving'}
          className="rounded-full bg-neutral-900 px-8 py-3 font-medium text-white disabled:opacity-30 dark:bg-neutral-100 dark:text-neutral-900"
        >
          保存
        </button>
      </footer>
    </div>
  )
}
