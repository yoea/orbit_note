'use client'

import { useState } from 'react'
import { useUserName } from '@/lib/client/use-user-name'
import AddPasskeyPanel from './AddPasskeyPanel'
import ConfirmDialog from './ConfirmDialog'
import { DIALOG_FOOTER_BUTTON_CLASS } from '@/lib/client/ui'

export interface PasskeyInfo {
  id: string
  device: string | null
  createdAt: string
  lastUsedAt: string | null
  credentialIdMasked: string
  disabled: boolean
  /** 是否已完成设置（有对应的 PRF wrapper）。false = 注册最后一步没走完，这把钥匙解不开日记 */
  ready: boolean
  isCurrent?: boolean
}

// Passkey 设备弹窗（iOS Alert 风格卡片）：列出各设备注册的通行密钥。
//
// 两种「不可用」状态，语义完全不同，界面上必须区分（2026-10-10）：
//   · 已禁用（软禁用）：凭证与 wrapper 都在，只是被标记 disabled —— 随时可**启用**；
//   · 未完成：注册流程只跑到「服务器已登记凭据」，没跑到「认证一次并保存 PRF wrapper」
//     （用户取消弹窗 / 网络断 / 直接关掉页面）。这种钥匙**认证会成功但永远解不开日记**，
//     唯一出路是**删除**后重新添加。上面的 `ready` 就是它。
//
// 已禁用的行：右侧**并排两个按钮**（启用 / 删除）—— 2026-10-10 用户要求：
// 原先的「启用 ▾」折叠展开多一步，禁用之后不该只能启用，就该直接给两个按钮。
//
// 信息行（「添加于 x 天前 · 最近使用：…」）**独占一整行**，排在按钮行之后：
// 2026-10-10 用户反馈「最近使用被截断」—— 根因是它原先与凭证尾号一起挤在按钮左侧，
// 禁用后右侧变成两个按钮，留给它的宽度只剩 ~160px。现在去掉凭证尾号 + 整行独占。
//
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
  // 待确认**删除**（硬删除）的那一条
  const [removing, setRemoving] = useState<PasskeyInfo | null>(null)

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

  // 彻底删除（硬删除）：`POST .../purge` 会连凭证带它的 PRF wrapper 一起删掉
  // （只删凭证会留下永远解不开的 wrapper，见该路由注释）。
  // 用 id（uuid）——列表页总是拿得到它；添加流程的自清理才走 credentialId 那条路。
  async function purge() {
    const pk = removing
    if (!pk || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/keys/passkeys/${pk.id}/purge`, { method: 'POST' })
      if (!res.ok) throw new Error('删除失败')
      setPasskeys((prev) => prev.filter((p) => p.id !== pk.id))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败，请重试')
    } finally {
      setBusy(false)
      setRemoving(null)
    }
  }

  // 「添加于 x 天前」——按**自然日**算（23:59 注册、00:01 查看不该算成 1 天前）
  const daysAgo = (s: string) => {
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(s))) / 86_400_000)
    return days <= 0 ? '今天' : `${days} 天前`
  }
  // 完整日期 + 时间（2026/10/10 11:23）——「最近使用」要能一眼看出是哪天
  const fmtDateTime = (s: string) => {
    const d = new Date(s)
    return `${d.toLocaleDateString('zh-CN')} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
  }
  // 还能真正解锁日记的钥匙数量（未完成的不算，已禁用的不算）——用于删除确认的强提示
  const usableCount = passkeys.filter((p) => p.ready && !p.disabled).length

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
              <li key={pk.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-neutral-800 dark:text-neutral-200">
                      <span className={pk.disabled ? 'text-neutral-500 dark:text-neutral-400' : undefined}>{pk.device ?? '未知设备'}</span>
                      {/* 当前会话登录用的那把 key（登录后自动标注） */}
                      {pk.isCurrent && !pk.disabled && (
                        <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-500">当前</span>
                      )}
                      {/* 未完成（无 PRF wrapper）：注册最后一步没走完，认证能过但解不开日记 */}
                      {!pk.ready ? (
                        <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">未完成</span>
                      ) : pk.disabled && (
                        /* 已禁用（软禁用，可重新启用或彻底删除） */
                        <span className="rounded-full bg-neutral-500/10 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:text-neutral-400">已禁用</span>
                      )}
                    </p>
                  </div>
                  {!pk.ready ? (
                    /* 未完成：只能删除（它既没有「启用」的意义，也不该让人以为可以救活） */
                    <button
                      onClick={() => setRemoving(pk)}
                      disabled={busy}
                      className="shrink-0 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white active:opacity-70 disabled:opacity-40"
                    >
                      删除
                    </button>
                  ) : pk.disabled ? (
                    /* 已禁用：**直接并排两个按钮**（启用 / 删除）。
                       2026-10-10 用户要求去掉「启用 ▾」折叠那一级 —— 一步可达，不用先展开。 */
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        onClick={() => void enable(pk)}
                        disabled={busy}
                        className="rounded-lg bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-3 py-1.5 text-xs font-medium text-white active:opacity-70 disabled:opacity-40"
                      >
                        启用
                      </button>
                      <button
                        onClick={() => setRemoving(pk)}
                        disabled={busy}
                        className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white active:opacity-70 disabled:opacity-40"
                      >
                        删除
                      </button>
                    </div>
                  ) : (
                    /* 可用：禁用（红色填充小按钮，破坏性语义，样式与主题按钮统一） */
                    <button
                      onClick={() => setConfirming(pk)}
                      disabled={busy}
                      className="shrink-0 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white active:opacity-70 disabled:opacity-40"
                    >
                      禁用
                    </button>
                  )}
                </div>
                {/* 信息行：**独占一整行**（排在按钮行之后），因此永远不会被按钮挤断。
                    2026-10-10 用户反馈「最近使用被截断」—— 根因是它原先与凭证尾号挤在按钮左侧，
                    禁用后右侧变成两个按钮，留给它的宽度只剩 ~160px。同时按用户要求：
                    去掉凭证尾号、把「添加于」改成天数。 */}
                <p className="mt-1 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                  添加于 {daysAgo(pk.createdAt)} · {pk.lastUsedAt ? `最近使用：${fmtDateTime(pk.lastUsedAt)}` : '从未使用'}
                </p>
              </li>
            ))}
          </ul>
          )}
          {error && <p className="mt-3 text-center text-sm text-red-500">{error}</p>}
          <p className="mt-4 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
            {passkeys.some((p) => !p.ready)
              ? '「未完成」的通行密钥在注册最后一步没走完，无法解锁日记 —— 请删除后重新添加'
              : '禁用后该设备无法登录，可随时重新启用或彻底删除'}
          </p>
          </>
          )}
        </div>
        {/* 底部单按钮（完成 / 返回列表）：直贴卡片边缘的一整行，样式取共享常量。
            ★ 本卡片是**普通块级**容器，<button> 默认 inline-block，必须靠常量里的 w-full
              撑满——否则「完成」两个字会缩成一小块贴在左边（2026-09-30 用户反馈的
              「通行密钥弹窗按钮错乱」）。此前还是「p-3 包裹 + 圆角胶囊」（约 76px），
              与 PrefsDialog 的「完成」高度不一致。 */}
        <button onClick={view === 'list' ? onClose : () => setView('list')} className={DIALOG_FOOTER_BUTTON_CLASS}>
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
      {/* 删除确认（硬删除，不可逆 —— 所以必须二次确认，且文案要说清后果）。
          「未完成」的那类走的是同一条，只是文案不同（删掉它没有任何损失）。 */}
      {removing && (
        <ConfirmDialog
          title={`删除 ${removing.device ?? '此设备'} 的通行密钥？`}
          message={
            !removing.ready
              ? '这把通行密钥没有完成设置、无法解锁日记。删除它不会影响其他通行密钥。'
              : usableCount <= 1
                ? '这是最后一个能解锁日记的通行密钥，删除后只能用恢复密钥登录。确定删除？'
                : '该设备将无法再用通行密钥登录，需要重新添加才能恢复。确定删除？'
          }
          confirmText="删除"
          cancelText="取消"
          destructive
          onConfirm={() => void purge()}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
