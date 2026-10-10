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

// 「删除所有数据」入口 —— 根节点是**普通块级 <div>**（2026-10-10 起挂在「关于」弹窗里，
// 不再是设置页的列表项，所以不再返回 <li>；<div> 不依赖任何列表上下文，放哪都合法）。
//
// 为什么从导出页搬到这里：它原先挂在 /settings/export 的底部（且是在**未验证身份**阶段就露出），
// 而那个页面的语义是"导出"。一个不可逆销毁全部数据的操作，放在语义正好相反的页面上，
// 用户很容易把它理解成导出流程的一环（"导出后清理本地数据"）。这是位置错位，不是样式问题。
//
// ★ 演进：三次「降低可发现性」，别再往回加东西 ——
//   ① 2026-09-30「默认收起」：原先它是设置页最后一行、红字带副标题，在一个"平时只会翻一遍"的
//      设置页里权重过高，且正好停在拇指滑到底的位置。改成 disclosure（`危险操作 ›`），
//      让默认视图里**没有红色项**，真要删时才多一次点击。
//   ② 2026-10-10 上午「移出设置页」：入口挪进「关于 Orbit」弹窗最底部 —— 在设置页里它无论怎么
//      缩小都还是"一条设置项"的观感。
//   ③ 2026-10-10（本次）「**去掉折叠那一级**」：用户原话「关于页面不用再多加一级『危险操作』了，
//      直接显示一个小小的文字删除所有数据作为入口即可」。
//      ⇒ 直接渲染一行小字入口，点它即进确认流程；`危险操作 ›` 触发器、`aria-expanded` 与
//        open 状态**一并删除**（留着就是死代码）。
//
// 剩余的一道可见门槛 + 一道交互门槛：入口本身（小字、中性色、沉在弹窗最底部）
//   → 输入「永久删除」→ 通行密钥验证。**误触成本依然极低**：点一下只会弹出需要输字的确认框，
//   不输那几个字就走不到下一步。
//
// 视觉：居中 + `text-xs` + 中性灰（用户要"小小的文字"）。
//   ★ `w-fit` 必需：块级 flex 元素默认占满整行，只写 mx-auto 是**空操作**，不会居中。
//   ★ 刻意**不染红**：红色留给点击后的确认弹窗（destructive）——入口不喊，危险由那一步承担。
//
// disabled / onBlocked 与设置页其余入口一致：离线时视觉置灰，但点击仍触发（弹「离线不可用」提示）
// ——无声置灰比明确提示更让人困惑。真正的破坏还需通行密钥验证，离线时那一步本就会失败，
// 这里的置灰只是省掉用户白走两步。
// ★ 置灰现在就作用在**入口本身**上（原先有折叠时，它只作用在展开后的删除行 —— 那两级已合并）。
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
    <div>
      {/* 入口 = **一行小小文字**（没有折叠这一级，见文件头「演进 ③」）。
          点击即进「输入『永久删除』」确认；离线时走 onBlocked（与设置页其余写操作一致）。
          `mx-auto` + `w-fit`：居中（★ 少了 w-fit 就是空操作）；
          `text-xs` + 中性灰：与降级 ② 同一档观感（用户要"小小的文字"）。 */}
      <button
        onClick={() => { if (disabled) { onBlocked?.(); return } setConfirmStep(1) }}
        disabled={wiping}
        className={`mx-auto flex w-fit items-center justify-center rounded-lg px-3 py-2 text-xs text-neutral-500 active:opacity-60 disabled:opacity-50 dark:text-neutral-400 ${disabled ? 'opacity-50' : ''}`}
      >
        <p>删除所有数据</p>
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
    </div>
  )
}
