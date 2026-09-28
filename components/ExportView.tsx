'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import InputConfirmDialog from '@/components/InputConfirmDialog'
import { clearDek, getDek } from '@/lib/client/session'
import { decryptText } from '@/lib/client/crypto/encryption'
import { verifyWithPasskey, verifyWithRecoveryKey } from '@/lib/client/verify'
import { idbClearAll } from '@/lib/client/idb'
import { useUserName } from '@/lib/client/use-user-name'

interface Entry {
  id: string
  ciphertext: string
  iv: string
  createdAt: string
  updatedAt: string
  latitude: number | null
  longitude: number | null
  locationName: string | null
  weather: string | null
  timezone: string | null
  wordCount: number
}

// 删除所有数据：必须手动输入这段文字才能通过（防误触强确认）
const WIPE_CONFIRM_TEXT = '永久删除'

// CSV 字段转义（RFC 4180）：含逗号/引号/换行的字段用双引号包裹，内部引号翻倍
function csvField(v: string | number | null): string {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// 导出笔记页（/settings/export）：验证身份（通行密钥或恢复密钥二选一）→ 拉取全部密文 →
// 客户端解密 → 生成 CSV 下载。明文只在本地生成，不上传服务器。
// 删除所有数据入口弱化置于本页底部（验证身份阶段）。
export default function ExportView() {
  const router = useRouter()
  const [verified, setVerified] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wipeConfirmStep, setWipeConfirmStep] = useState<0 | 1>(0)
  const [wiping, setWiping] = useState(false)
  // 导出成功后的返回倒计时（明文文件已下载，提示谨慎保存并自动返回设置页释放内存）
  const [countdown, setCountdown] = useState(0)
  const userName = useUserName()

  // 文件名（本地日期，与下载一致）
  const now = new Date()
  const fileName = `orbit-export-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.csv`

  async function verifyPasskey() {
    setBusy(true); setError(null)
    try {
      if (await verifyWithPasskey()) {
        setVerified(true)
      } else {
        setError('身份验证未完成')
      }
    } finally {
      setBusy(false)
    }
  }

  async function verifyRecovery() {
    if (!recoveryKey.trim()) return
    setBusy(true); setError(null)
    try {
      if (await verifyWithRecoveryKey(recoveryKey.trim())) {
        setVerified(true)
      } else {
        setError('恢复密钥验证失败')
      }
    } finally {
      setBusy(false)
    }
  }

  // 导出成功后：10 秒倒计时自动返回设置页（组件卸载 → 解密数据与页面状态全部释放）。
  // 倒计时初值在导出成功处与 setExported 一起设置，这里只负责走秒——
  // 避免在 effect 里同步 setState（react-hooks/set-state-in-effect）。
  useEffect(() => {
    if (exported == null) return
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(t)
          router.replace('/settings')
          return 0
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [exported, router])

  // 拉取全部条目（分页循环）→ 解密 → 组装 CSV → 下载
  async function exportCsv() {
    const dek = getDek()
    if (!dek) return
    setExporting(true); setError(null)
    try {
      // 1. 拉取全部
      const all: Entry[] = []
      let offset = 0
      while (true) {
        const res = await fetch(`/api/diary?limit=200&offset=${offset}`)
        if (!res.ok) throw new Error('加载失败')
        const { entries } = await res.json() as { entries: Entry[] }
        all.push(...entries)
        if (entries.length < 200) break
        offset += entries.length
      }
      // 2. 解密并组装行（按创建时间倒序，与服务端一致）
      const rows: string[][] = []
      for (const e of all) {
        let body = ''
        try {
          body = await decryptText(dek, e.ciphertext, e.iv)
        } catch {
          body = '(解密失败)'
        }
        rows.push([
          e.id, e.createdAt, e.updatedAt, body,
          e.wordCount,
          e.latitude == null ? '' : String(e.latitude),
          e.longitude == null ? '' : String(e.longitude),
          e.locationName ?? '',
          e.weather ?? '',
          e.timezone ?? '',
        ].map(csvField))
      }
      // 3. 生成 CSV（带 BOM：Excel 打开中文不乱码）
      const header = ['id', 'created_at', 'updated_at', 'body', 'word_count', 'latitude', 'longitude', 'location_name', 'weather', 'timezone'].join(',')
      const csv = '﻿' + header + '\n' + rows.map((r) => r.join(',')).join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
      // 倒计时初值随导出一并设置（走秒逻辑见上方 effect）
      setCountdown(10)
      setExported(all.length)
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败，请重试')
    } finally {
      setExporting(false)
    }
  }

  // 删除所有数据（物理删除，入口弱化置于本页底部）
  async function wipe() {
    setWiping(true)
    try {
      const ok = await verifyWithPasskey()
      if (!ok) {
        window.alert('身份验证未完成，未执行删除')
        return
      }
      const res = await fetch('/api/admin/wipe', { method: 'POST' })
      if (!res.ok) throw new Error()
      await idbClearAll()
      clearDek()
      router.replace('/setup')
    } catch {
      window.alert('删除失败，请重试')
    } finally {
      setWiping(false)
    }
  }

  return (
    <main className="mx-auto h-full w-full max-w-md overflow-y-auto px-5 safe-pt safe-pb">
      <header className="relative flex items-center justify-between py-3">
        {/* iOS 原生风格返回：chevron 箭头（原生路由返回，右滑手势同样生效）；标题绝对居中 */}
        <Link href="/settings" aria-label="返回" className="-ml-1 px-1 text-2xl leading-none text-neutral-400">
          ‹
        </Link>
        <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold">导出笔记</h1>
        <span className="w-8" />
      </header>

      {/* 顶部说明：验证成功前后都保留 */}
      <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
        将{userName ? `${userName}的` : ''}全部日记导出为 <span className="font-medium">CSV</span> 文件，包含所有字段（正文、创建/更新时间、坐标、地点名、时区、字数）。
      </p>
      <p className="mt-1 text-xs leading-relaxed text-neutral-400">
        正文以加密状态存储，导出时在本地解密——明文只在你设备上生成下载，不会上传服务器。
      </p>

      {!verified ? (
        <>
          {/* 验证阶段 */}
          <p className="mt-4 text-sm font-medium text-neutral-800 dark:text-neutral-200">先验证身份（二选一）</p>
          <div className="mt-2 flex flex-col gap-3">
            <button
              onClick={() => void verifyPasskey()}
              disabled={busy}
              className="w-full rounded-2xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 py-3.5 font-medium text-white disabled:opacity-50"
            >
              {busy ? '正在验证…' : '使用通行密钥验证'}
            </button>
            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
              <span className="text-xs text-neutral-400">或</span>
              <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
            </div>
            <input
              value={recoveryKey}
              onChange={(e) => setRecoveryKey(e.target.value)}
              placeholder="输入恢复密钥"
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-base outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
            <button
              onClick={() => void verifyRecovery()}
              disabled={busy || !recoveryKey.trim()}
              className="w-full rounded-xl border border-neutral-300 py-3 text-sm font-medium text-neutral-700 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300"
            >
              {busy ? '正在验证…' : '使用恢复密钥验证'}
            </button>
            {error && <p className="text-center text-sm text-red-500">{error}</p>}
          </div>
          {/* 危险操作弱化入口：小字置底，防误触（真正删除还需文字验证 + 通行密钥验证） */}
          <div className="pt-10 text-center">
            <button
              onClick={() => setWipeConfirmStep(1)}
              disabled={wiping}
              className="text-xs text-neutral-400/70 disabled:opacity-50"
            >
              {wiping ? '验证中…' : '删除所有数据'}
            </button>
          </div>
        </>
      ) : (
        <>
          {/* 验证通过：保留顶部说明，下方显示文件名与下载 */}
          <p className="mt-4 text-sm font-medium text-emerald-600 dark:text-emerald-400">✓ 身份已验证</p>
          <div className="mt-4 rounded-2xl border border-neutral-100 bg-neutral-50/60 px-4 py-3.5 dark:border-neutral-800 dark:bg-neutral-900/40">
            <p className="text-xs text-neutral-400">导出文件</p>
            <p className="mt-1 break-all font-mono text-sm text-neutral-800 dark:text-neutral-200">{fileName}</p>
          </div>
          <button
            onClick={() => void exportCsv()}
            disabled={exporting}
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 py-4 font-medium text-white disabled:opacity-50"
          >
            {exporting ? '解密导出中…' : '下载导出的文件'}
          </button>
          {exported != null && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                已导出 {exported} 篇，文件已开始下载
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                文件为解密后的明文内容，请谨慎保存，避免在公共设备上保留。
              </p>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                {countdown} 秒后自动返回设置页
              </p>
            </div>
          )}
          {exported != null && (
            <button
              onClick={() => router.replace('/settings')}
              className="mt-3 w-full rounded-2xl border border-neutral-200 py-3.5 text-sm font-medium text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
            >
              立即返回设置
            </button>
          )}
          {error && <p className="mt-2 text-center text-sm text-red-500">{error}</p>}
        </>
      )}

      {wipeConfirmStep === 1 && (
        <InputConfirmDialog
          title="删除确认"
          message={
            <>
              {userName ? `${userName}的` : ''}所有日记、通行密钥与恢复密钥将全部删除，<span className="font-semibold text-red-500">无法恢复</span>，账号也将被删除。请输入「{WIPE_CONFIRM_TEXT}」确认，之后将通过通行密钥验证身份。
            </>
          }
          expected={WIPE_CONFIRM_TEXT}
          placeholder={WIPE_CONFIRM_TEXT}
          confirmText="删除"
          destructive
          onConfirm={() => { setWipeConfirmStep(0); void wipe() }}
          onCancel={() => setWipeConfirmStep(0)}
        />
      )}
    </main>
  )
}
