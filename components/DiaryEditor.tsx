'use client'

import { useEffect, useRef, useState } from 'react'
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
  const textRef = useRef('')
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingDraftRef = useRef<{ ciphertext: string; iv: string } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // 卸载时清理定时器（状态复位 + 草稿防抖），避免卸载后 setState / 泄漏
  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

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
        let bestUpdatedAt = 0
        if (local) {
          let localText = ''
          try { localText = await decryptText(dek, local.ciphertext, local.iv) } catch { /* 损坏草稿忽略 */ }
          const decision = pickNewer({ updatedAt: local.updatedAt, text: localText }, server ? { updatedAt: new Date(server.updatedAt).getTime() } : null)
          if (decision && decision.text.trim() !== '') {
            best = { ciphertext: local.ciphertext, iv: local.iv }
            bestUpdatedAt = local.updatedAt
          }
        }
        if (server && !best) {
          // 本地无草稿或本地更空 → 用服务器草稿（若服务器内容非空）
          best = { ciphertext: server.ciphertext, iv: server.iv }
          bestUpdatedAt = new Date(server.updatedAt).getTime()
        }
        if (best) {
          pendingDraftRef.current = best
          setShowDraftBanner(true)
        }
      } catch { /* 草稿加载失败不阻塞编辑 */ }
    })()
  }, [])

  // 防抖保存：输入 1000ms 后加密存 IndexedDB（本地优先），随后尽力同步服务器
  function onDraftChange(text: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const dek = getDek()
          if (!dek || !text.trim()) return
          const { ciphertext, iv } = await encryptText(dek, text)
          const record = { ciphertext, iv, encryptionVersion: 1, updatedAt: Date.now() }
          await saveLocalDraft(record) // 本地优先（离线可用）
          void pushServerDraft(record).catch(() => {}) // 服务器同步尽力而为（离线静默失败，下次输入/页面加载重试）
        } catch { /* 草稿保存失败不阻塞输入 */ }
      })()
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

  // 放弃草稿：清本地 IndexedDB 与服务器
  async function discardDraft() {
    pendingDraftRef.current = null
    setShowDraftBanner(false)
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
        <a href="/settings" className="text-sm text-neutral-400">设置</a>
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
