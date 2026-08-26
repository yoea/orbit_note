'use client'

import { useEffect, useRef, useState } from 'react'
import AutoTextarea from './AutoTextarea'
import { getDek } from '@/lib/client/session'
import { encryptText } from '@/lib/client/crypto/encryption'
import { getPosition } from '@/lib/client/location'

// 草稿占位（Task 10 从 lib/client/draft-sync 导入真实实现）
function onDraftChange(_text: string): void {}
function clearLocalDraft(): Promise<void> { return Promise.resolve() }

export default function DiaryEditor() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [savedTime, setSavedTime] = useState('')
  const textRef = useRef('')
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // 卸载时清理状态复位定时器，避免卸载后 setState
  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current)
    }
  }, [])

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
