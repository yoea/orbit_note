'use client'

import { useState } from 'react'
import { useUserName } from '@/lib/client/use-user-name'
import AddPasskeyPanel from './AddPasskeyPanel'
import ConfirmDialog from './ConfirmDialog'

export interface PasskeyInfo {
  id: string
  device: string | null
  createdAt: string
  lastUsedAt: string | null
  credentialIdMasked: string
  disabled: boolean
  isCurrent?: boolean
}

// Passkey 设备弹窗（iOS Alert 风格卡片）：列出各设备注册的通行密钥。
// 禁用 = 软禁用（该设备无法登录，凭证保留，可随时重新启用）。
// 数据由设置页预取后传入（initialData）——弹窗打开第一帧即完整列表，无加载闪烁；
// 预取失败（initialData=null）时显示错误 + 重试。
//
// 两个视图（列表 / 添加）都在本弹窗内切换：原先右上角的 ＋ 会跳转整页 /settings/passkey，
// 返回时落回设置页而不是这个弹窗——用户在弹窗里点一下突然变成整页，体感是断的。
export default function PasskeysDialog({ initialData, onClose }: {
  initialData: PasskeyInfo[] | null
  onClose: () => void
}) {
  const userName = useUserName()
  const [view, setView] = useState<'list' | 'add'>('list')
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>(initialData ?? [])
  const [loadFailed, setLoadFailed] = useState(initialData == null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<PasskeyInfo | null>(null)
  const [busy, setBusy] = useState(false)

  // 拉取列表：初始预取失败后的重试、以及添加新凭据成功后刷新，共用这一条
  async function load() {
    setLoadFailed(false)
    try {
      const res = await fetch('/api/keys/passkeys')
      if (!res.ok) throw new Error('加载失败')
      const data = await res.json() as { passkeys: PasskeyInfo[] }
      setPasskeys(data.passkeys)
    } catch {
      setLoadFailed(true)
    }
  }

  // 禁用（软禁用：凭证保留，仅标记 disabled）
  async function disable() {
    const pk = confirming
    if (!pk || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/keys/passkeys/${pk.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('禁用失败')
      setPasskeys((prev) => prev.map((p) => (p.id === pk.id ? { ...p, disabled: true } : p)))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '禁用失败，请重试')
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  // 重新启用
  async function enable(pk: PasskeyInfo) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/keys/passkeys/${pk.id}/enable`, { method: 'POST' })
      if (!res.ok) throw new Error('启用失败')
      setPasskeys((prev) => prev.map((p) => (p.id === pk.id ? { ...p, disabled: false } : p)))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '启用失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  // "月-日"短格式（同一列表里年份冗余）
  const fmtShort = (s: string) => {
    const d = new Date(s)
    return `${d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`
  }
  // "月-日 时:分"（最近使用需要精确到时间）
  const fmtShortTime = (s: string) => {
    const d = new Date(s)
    return `${d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-8" onClick={onClose}>
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={view === 'add' ? '添加通行密钥' : userName ? `${userName}的通行密钥` : '通行密钥'}
      >
        <div className="max-h-[70dvh] overflow-y-auto px-5 py-6">
          {view === 'add' ? (
            <>
              <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">添加通行密钥</p>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">在这台设备上注册</p>
              <AddPasskeyPanel onAdded={() => { setView('list'); void load() }} />
            </>
          ) : (
          <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{userName ? `${userName}的通行密钥` : '通行密钥'}</p>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">管理各设备上的通行密钥</p>
            </div>
            {/* 添加新 Passkey：弱化为右上角加号，切到本弹窗的添加视图（不动路由——
                原先跳 /settings/passkey 整页，返回时落回设置页而不是这个弹窗） */}
            <button
              onClick={() => setView('add')}
              aria-label="注册新的通行密钥"
              className="shrink-0 text-2xl font-light leading-6 text-neutral-500 dark:text-neutral-400 active:opacity-60"
            >
              ＋
            </button>
          </div>
          {loadFailed ? (
            <div className="flex flex-col items-center gap-2 py-6">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">加载失败</p>
              <button onClick={() => void load()} className="rounded-lg bg-neutral-100 px-4 py-1.5 text-sm text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                重试
              </button>
            </div>
          ) : passkeys.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">没有已注册的通行密钥</p>
          ) : (
          <ul className="mt-4 divide-y divide-neutral-100 dark:divide-neutral-800">
            {passkeys.map((pk) => (
              <li key={pk.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-neutral-800 dark:text-neutral-200">
                    <span className={pk.disabled ? 'text-neutral-500 dark:text-neutral-400' : undefined}>{pk.device ?? '未知设备'}</span>
                    {/* 当前会话登录用的那把 key（登录后自动标注） */}
                    {pk.isCurrent && !pk.disabled && (
                      <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-500">当前</span>
                    )}
                    {/* 已禁用（软禁用，可重新启用） */}
                    {pk.disabled && (
                      <span className="rounded-full bg-neutral-500/10 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:text-neutral-400">已禁用</span>
                    )}
                  </p>
                  {/* 信息行：添加/最近使用左对齐，凭证尾号右对齐（信息区 flex-1 撑满至按钮左侧） */}
                  <div className="mt-0.5 flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                      添加于 {fmtShort(pk.createdAt)} · {pk.lastUsedAt ? `最近使用 ${fmtShortTime(pk.lastUsedAt)}` : '从未使用'}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-neutral-500 dark:text-neutral-400">{pk.credentialIdMasked}</span>
                  </div>
                </div>
                {pk.disabled ? (
                  /* 启用：主题渐变小按钮（与全局按钮统一） */
                  <button
                    onClick={() => void enable(pk)}
                    disabled={busy}
                    className="shrink-0 rounded-lg bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-3 py-1.5 text-xs font-medium text-white active:opacity-70 disabled:opacity-40"
                  >
                    启用
                  </button>
                ) : (
                  /* 禁用：红色填充小按钮（破坏性语义，样式与主题按钮统一） */
                  <button
                    onClick={() => setConfirming(pk)}
                    disabled={busy}
                    className="shrink-0 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white active:opacity-70 disabled:opacity-40"
                  >
                    禁用
                  </button>
                )}
              </li>
            ))}
          </ul>
          )}
          {error && <p className="mt-3 text-center text-sm text-red-500">{error}</p>}
          <p className="mt-4 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">禁用后该设备无法登录，可随时重新启用</p>
          </>
          )}
        </div>
        {/* 底部单按钮（完成 / 返回列表）：直贴卡片边缘的一整行，与 AboutDialog、PrefsDialog
            的「完成」同一种结构（border-t + py-3.5，约 52px）。此前是「p-3 包裹 + 圆角胶囊」
            （约 76px），同一族弹窗的关闭按钮高度不一致。 */}
        <button
          onClick={view === 'list' ? onClose : () => setView('list')}
          className="shrink-0 border-t border-neutral-200 py-3.5 text-base font-medium text-neutral-500 active:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:active:bg-neutral-700"
        >
          {view === 'list' ? '完成' : '返回列表'}
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          title={`禁用 ${confirming.device ?? '此设备'} 的通行密钥？`}
          message={
            passkeys.length <= 1
              ? '这是最后一个通行密钥，禁用后将无法用通行密钥登录，只能使用恢复密钥解锁。确定继续？'
              : '该设备将立即无法登录。确定继续？'
          }
          confirmText="禁用"
          cancelText="取消"
          destructive
          onConfirm={() => void disable()}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  )
}
