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
// 而那个页面的语义是"备份"。一个不可逆销毁全部数据的操作，放在语义正好相反的页面上，
// 用户很容易把它理解成导出流程的一环（"导出后清理本地数据"）。这是位置错位，不是样式问题。
//
// 放在设置页「数据」组的末行：它删的就是数据，归这里语义正确；用红色文字而非新增一个
// 分组标题来表达危险，符合本项目「不为一行内容单开分组标题」的既有惯例。
//
// 两道确认不变：先输入「永久删除」，再走通行密钥验证（与导出同一套认证链路）。
//
// disabled / onBlocked 与设置页其余入口一致：离线时视觉置灰，但点击仍触发（弹「离线不可用」提示）
// ——无声置灰比明确提示更让人困惑。真正的破坏还需通行密钥验证，离线时那一步本就会失败，
// 这里的置灰只是省掉用户白走两步。
export default function WipeDataAction({ disabled = false, onBlocked }: {
  disabled?: boolean
  onBlocked?: () => void
}) {
  const router = useRouter()
  const userName = useUserName()
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
      <button
        onClick={() => { if (disabled) { onBlocked?.(); return } setConfirmStep(1) }}
        disabled={wiping}
        className={`flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60 disabled:opacity-50 ${disabled ? 'opacity-50' : ''}`}
      >
        <div>
          <p className="text-red-500 dark:text-red-400">删除所有数据</p>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">永久删除全部日记、通行密钥与恢复密钥</p>
        </div>
        <span className="text-lg text-neutral-500 dark:text-neutral-400">›</span>
      </button>
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
