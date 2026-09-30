'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import InputConfirmDialog from './InputConfirmDialog'
import { clearDek } from '@/lib/client/session'
import { verifyWithPasskey } from '@/lib/client/verify'
import { idbClearAll } from '@/lib/client/idb'
import { useUserName } from '@/lib/client/use-user-name'

// 删除所有数据：必须手动输入这段文字才能通过（防误触强确认）
const WIPE_CONFIRM_TEXT = '永久删除'

// 「删除所有数据」入口 —— 返回一个 <li>，供设置页的列表直接嵌入。
//
// 为什么从导出页搬到这里：它原先挂在 /settings/export 的底部（且是在**未验证身份**阶段就露出），
// 而那个页面的语义是"导出"。一个不可逆销毁全部数据的操作，放在语义正好相反的页面上，
// 用户很容易把它理解成导出流程的一环（"导出后清理本地数据"）。这是位置错位，不是样式问题。
//
// ★ 为什么默认**收起**（2026-09-30）：
//   这个功能的使用频率极低（一辈子可能一次），但它此前是设置页最后一行、红字、带副标题，
//   在一个"平时只会翻一遍"的设置页里权重过高：既占一行带说明的页高，又正好停在拇指滑到底
//   的位置上。展开式（disclosure）让默认视图里**没有红色项**，真要删时才多一次点击。
//   折叠触发器刻意用**中性色**（不是红色）——危险由展开后的红字与两道确认承担，
//   不在默认视图里提前喊。守卫 tests/settings-structure.test.ts P9/P10。
//
// 两道确认不变：先输入「永久删除」，再走通行密钥验证（与导出同一套认证链路）。
//
// disabled / onBlocked 与设置页其余入口一致：离线时视觉置灰，但点击仍触发（弹「离线不可用」提示）
// ——无声置灰比明确提示更让人困惑。真正的破坏还需通行密钥验证，离线时那一步本就会失败，
// 这里的置灰只是省掉用户白走两步。
// 注意：置灰只作用在**展开后的删除行**上——折叠触发器本身只是展开/收起，不需要联网。
export default function WipeDataAction({ disabled = false, onBlocked }: {
  disabled?: boolean
  onBlocked?: () => void
}) {
  const router = useRouter()
  const userName = useUserName()
  const [open, setOpen] = useState(false)
  const [confirmStep, setConfirmStep] = useState<0 | 1>(0)
  const [wiping, setWiping] = useState(false)

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
    <li>
      {/* 折叠触发器：默认收起，中性色（见文件头「为什么默认收起」） */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60"
      >
        <p className="text-neutral-800 dark:text-neutral-200">危险操作</p>
        {/* 展开时箭头转向下（静态旋转，不引入过渡属性） */}
        <svg
          aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          className={`h-4 w-4 shrink-0 text-neutral-500 dark:text-neutral-400 ${open ? 'rotate-90' : ''}`}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-3.5">
          <button
            onClick={() => { if (disabled) { onBlocked?.(); return } setConfirmStep(1) }}
            disabled={wiping}
            className={`w-full rounded-xl border border-red-200 px-4 py-3 text-left active:opacity-60 disabled:opacity-50 dark:border-red-900 ${disabled ? 'opacity-50' : ''}`}
          >
            <p className="text-red-500 dark:text-red-400">删除所有数据</p>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">永久删除全部日记、通行密钥与恢复密钥</p>
          </button>
        </div>
      )}
      {confirmStep === 1 && (
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
          onConfirm={() => { setConfirmStep(0); void wipe() }}
          onCancel={() => setConfirmStep(0)}
        />
      )}
    </li>
  )
}
