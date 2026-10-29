'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fetchSession, fetchWrappers } from '@/lib/client/session'
import { createWrappedDek, unwrapWithRecoveryKey } from '@/lib/client/crypto/setup'
import { decodeRecoveryKey, generateRecoveryKey, sha256Hex } from '@/lib/client/crypto/recovery-key'
import { copyText } from '@/lib/client/clipboard'
import { DIALOG_FOOTER_BUTTON_CLASS } from '@/lib/client/ui'
import { useDialogBehavior } from '@/lib/client/dialog'
import { recoveryInfoFromWrappers, type RecoveryKeyInfo } from '@/lib/client/recovery-info'

// 重新生成恢复密钥弹窗（iOS Alert 风格卡片）：输入当前密钥验证（能解开 wrapper 才算正确）→
// 生成新密钥 → 用新密钥重新包裹 DEK 并更新服务器（wrapper + SHA-256 哈希）。旧密钥立即失效。
export default function RecoveryRegenerateDialog({ onClose, initialInfo = null, onInfoChange }: {
  onClose: () => void
  /** 设置页预取好的辨认信息（指纹 + 创建时间）。给了它 ⇒ 打开第一帧就有内容、**零闪烁** */
  initialInfo?: RecoveryKeyInfo | null
  /** 重新生成成功后回报新的辨认信息（否则设置页下次打开仍显示旧指纹） */
  onInfoChange?: (info: RecoveryKeyInfo) => void
}) {
  const router = useRouter()
  const [currentKey, setCurrentKey] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  // 辨认信息（指纹 + 创建时间）：**父组件预取的优先**；没有才自己取（兜底）。
  // ★ 2026-10-29 用户反馈「点开时闪一下」：这一行原先是弹窗挂载后异步取到的，
  //   取到就把下方内容顶下去（布局跳动）。现在两处一起治：
  //   ① 设置页在打开前就把信息取好（initialInfo）⇒ 打开第一帧即完整；
  //   ② 兜底那条路也有**固定高度的槽位**（见渲染处 min-h-4）⇒ 迟到也不跳。
  const [fetchedInfo, setFetchedInfo] = useState<RecoveryKeyInfo | null>(null)
  const aliveRef = useRef(true)
  const keyInfo = initialInfo ?? fetchedInfo
  // Esc / Tab 循环 / 焦点归还（2026-10-29）。★ Esc 与底部「完成」按钮**同一语义**：
  //   已经生成出新密钥时先尽力复制再关（否则用户一按 Esc 就把只显示一次的密钥弄丢了）。
  const cardRef = useRef<HTMLDivElement>(null)
  useDialogBehavior(cardRef, closeDialog)

  useEffect(() => {
    if (initialInfo) return // 预取到了就别再请求
    aliveRef.current = true
    void fetchWrappers()
      .then((wrappers) => {
        if (!aliveRef.current) return
        setFetchedInfo(recoveryInfoFromWrappers(wrappers))
      })
      .catch(() => { /* 静默：辨认信息只是辅助展示 */ })
    return () => { aliveRef.current = false }
  }, [initialInfo])

  async function handleCopyResult() {
    if (!result) return
    const ok = await copyText(result)
    setCopyState(ok ? 'copied' : 'failed')
  }

  /** 关闭：已经生成出新密钥时先尽力复制（与底部按钮、Esc 三处同一条路） */
  function closeDialog() {
    if (result) void copyText(result) // 尽力复制，失败不阻塞关闭
    onClose()
  }

  async function verifyAndProceed() {
    setBusy(true); setError(null)
    try {
      const wrappers = await fetchWrappers()
      const rec = wrappers.find((w) => w.wrapperType === 'recovery')
      if (!rec) throw new Error('未找到恢复包装')
      // 验证当前密钥：能解开 wrapper 才算正确
      const dek = await unwrapWithRecoveryKey(rec.encryptedDek, rec.salt, currentKey.trim())
      // 生成新 key，用新 key 包裹 DEK 并更新服务器（IKM 必须是 decodeRecoveryKey 解码后的 32 字节）
      const next = generateRecoveryKey()
      const wrapped = await createWrappedDek(dek, decodeRecoveryKey(next), 'recovery-kek')
      const up = await fetch('/api/keys/wrappers/recovery', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encryptedDek: wrapped.encryptedDek,
          salt: wrapped.salt,
          encryptionVersion: 1,
          recoveryKeyHash: await sha256Hex(next),
        }),
      })
      if (!up.ok) throw new Error('更新失败')
      setResult(next)
      // 换新 ⇒ 指纹与创建时间都变了：重取一次并回报设置页（否则它下次打开仍显示旧指纹）
      try {
        const fresh = recoveryInfoFromWrappers(await fetchWrappers())
        if (fresh) {
          setFetchedInfo(fresh)
          onInfoChange?.(fresh)
        }
      } catch { /* 取不到就沿用旧信息，不影响本流程 */ }
    } catch {
      // session 过期（fetchWrappers 401）→ 回登录页重新解锁；其余错误保持"验证失败"提示
      try {
        const s = await fetchSession()
        if (!s.authenticated) { onClose(); router.replace('/login'); return }
      } catch { /* 网络错误保持原提示 */ }
      setError('验证失败（当前恢复密钥不正确？）')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-8" onClick={onClose}>
      <div
        ref={cardRef}
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="重新生成恢复密钥"
      >
        <div className="max-h-[70dvh] overflow-y-auto px-5 py-6">
          {!result ? (
            /* 验证阶段 */
            <>
              <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">重新生成恢复密钥</p>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">先输入当前恢复密钥验证身份，验证通过后生成新密钥</p>
              {/* ★ 固定高度的槽位（min-h-4 = 一行 text-xs 的高度）：无论信息是预取到、
                  还是稍后异步到达，这一行的占位始终不变 ⇒ 下方内容不会被顶下去
                  （「点开时闪一下」就是这里引起的）。没取到时留空，不显示占位文案。 */}
              <p className="mt-2 min-h-4 text-xs text-neutral-500 dark:text-neutral-400">
                {keyInfo ? `当前密钥创建于 ${keyInfo.createdAt} · 指纹 ${keyInfo.fingerprint}` : ''}
              </p>
              <input
                value={currentKey}
                onChange={(e) => setCurrentKey(e.target.value)}
                placeholder="当前恢复密钥"
                aria-label="当前恢复密钥"
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                autoFocus
                className="mt-4 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-base outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
              <button
                onClick={() => void verifyAndProceed()}
                disabled={busy || !currentKey.trim()}
                className="mt-3 w-full rounded-xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 py-3 font-medium text-white disabled:opacity-50"
              >
                {busy ? '验证中…' : '验证'}
              </button>
              {error && <p role="alert" className="mt-3 text-center text-sm text-red-500">{error}</p>}
            </>
          ) : (
            /* 结果阶段：新密钥仅显示一次 */
            <>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">新的恢复密钥已生成，仅显示一次：</p>
              <code className="mt-2 block break-all rounded-xl bg-neutral-100 px-3 py-2.5 text-sm dark:bg-neutral-900">{result}</code>
              <button
                onClick={() => void handleCopyResult()}
                className="mt-2 text-sm text-neutral-500 dark:text-neutral-400 underline"
              >
                {copyState === 'copied' ? '已复制 ✓' : copyState === 'failed' ? '复制失败，请手动选择复制' : '复制恢复密钥'}
              </button>
              <p className="mt-3 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
                保存后旧密钥立即失效——请先妥善保存再关闭弹窗
              </p>
            </>
          )}
        </div>
        {/* 底部单按钮（完成 / 取消）：直贴卡片边缘的一整行，样式取共享常量。
            ★ 本卡片是**普通块级**容器，<button> 默认 inline-block，必须靠常量里的 w-full
              撑满，否则按钮会缩成两个字宽贴在左边（2026-09-30 用户反馈的「恢复密钥弹窗
              按钮错乱」）。 */}
        <button
          onClick={closeDialog}
          className={DIALOG_FOOTER_BUTTON_CLASS}
        >
          {result ? '完成' : '取消'}
        </button>
      </div>
    </div>
  )
}
