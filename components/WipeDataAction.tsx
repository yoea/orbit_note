'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ConfirmDialog from './ConfirmDialog'
import InputConfirmDialog from './InputConfirmDialog'
import { clearDek } from '@/lib/client/session'
import { verifyWithPasskey } from '@/lib/client/verify'
import { idbClearAll } from '@/lib/client/idb'
import { useUserName } from '@/lib/client/use-user-name'

// 删除所有数据：必须手动输入这段文字才能通过（防误触强确认）
const WIPE_CONFIRM_TEXT = '永久删除'

/**
 * 「删除所有数据」的完整流程（四步，2026-10-10 用户指定）。
 *
 * **入口不在这里** —— 在 AboutDialog：连点 LOGO「Orbit」8 次（彩蛋式隐藏入口，界面上
 * 没有任何可见按钮）。本组件只负责流程本身，**挂载即处于第一步**。
 *
 *   ① confirm   确认提示：是否进入删除流程（取消 → 整个流程放弃，什么都没发生）
 *   ② input     输入「永久删除」（强确认；输入不匹配时确认按钮不可点）
 *   ③ verifying 通行密钥验证（WebAuthn 在场验证，与导出走同一套链路）
 *   ④ final     最后一次确认（取消 / 确认删除）→ 真正执行
 *
 * ★ 为什么验证要放在**最后确认之前**：验证通过后界面已经"站在删除按钮上"，
 *   再给一次明确确认，用户不会因为"刚验完指纹"顺手把数据删掉（这是不可逆操作）。
 *
 * ★ 调用方必须用**条件渲染**（`{open && <WipeDataAction …/>}`）而不是传 `open` 属性：
 *   每次挂载都是干净的 state —— 任何一步取消都等价于放弃整个流程，下次触发必然从 ① 重来。
 *   （也避免在 effect 里 setState 重置，那会被 react-hooks/set-state-in-effect 拦下。）
 *
 * ★ 演进（这条功能的可发现性一路往下，别再往回加可见入口）：
 *   ① 2026-09-30 设置页末行 + 红字 → 折叠成 `危险操作 ›`（默认收起）；
 *   ② 2026-10-10 上午 移出设置页 → 「关于」弹窗最底部一行小字；
 *   ③ 2026-10-10 本次 **全隐藏**：连点 LOGO 8 次才出现，界面上再无任何入口。
 *   四步确认取代了原来的两步 —— 入口越隐蔽，越要把"误触代价"压到零：
 *   现在从误触到真删要连续通过 ①确认 → ②输字 → ③通行密钥 → ④再确认。
 */
export type WipeStep = 'confirm' | 'input' | 'verifying' | 'final'

export default function WipeDataAction({ onClose, disabled = false, onBlocked }: {
  onClose: () => void
  /** 离线禁用（与其余写操作一致）：第一步就拦下，不让用户白走三步到验证那一步才失败 */
  disabled?: boolean
  onBlocked?: () => void
}) {
  const router = useRouter()
  const userName = useUserName()
  const [step, setStep] = useState<WipeStep>('confirm')

  // ① → ②：离线时在这里拦下。这一步本身不联网（只是本地状态机），但其后的写操作必然失败，
  // 直接放弃整个流程并提示 —— 与设置页其余写操作的处理一致。
  function confirmStart() {
    if (disabled) { onBlocked?.(); onClose(); return }
    setStep('input')
  }

  // ② → ③：验证失败/被取消 → 提示并放弃整个流程。不留在"验了一半"的悬挂状态，
  // 也不静默返回（用户刚点了确认，必须知道为什么什么都没发生）。
  async function startVerify() {
    setStep('verifying')
    const ok = await verifyWithPasskey()
    if (!ok) {
      window.alert('身份验证未完成，未执行删除')
      onClose()
      return
    }
    setStep('final')
  }

  // ④ → 真正执行（身份已在 ③ 验证过，这里只做后端调用与本地清理）
  async function wipe() {
    try {
      const res = await fetch('/api/admin/wipe', { method: 'POST' })
      if (!res.ok) throw new Error()
      await idbClearAll()
      clearDek()
      router.replace('/setup')
    } catch {
      // 失败就停在④的确认弹窗上，让用户自己决定重试还是取消（不静默、不自动重试）
      window.alert('删除失败，请重试')
    }
  }

  return (
    // ★ 外层拦冒泡：本组件的每一屏都是 `fixed inset-0` 的全屏层，而它挂在**关于弹窗的遮罩内部**。
    //   若不拦，点流程遮罩的空白处（= 取消流程）会继续冒泡到关于弹窗的遮罩 onClick，
    //   把整个弹窗一起关掉 —— 用户只是想取消删除，却连关于页都退出了。
    //   卡片内部的点击本来就被 ConfirmDialog/InputConfirmDialog 自己 stopPropagation 了。
    <div onClick={(e) => e.stopPropagation()}>
      {step === 'confirm' && (
        <ConfirmDialog
          title="进入删除流程？"
          message="接下来需要输入确认文字「永久删除」并通过通行密钥验证，全部通过后还要再确认一次才会真正删除。"
          confirmText="继续"
          cancelText="取消"
          onConfirm={confirmStart}
          onCancel={onClose}
        />
      )}

      {step === 'input' && (
        <InputConfirmDialog
          title="删除确认"
          message={
            <>
              {userName ? `${userName}的` : ''}所有日记、通行密钥与恢复密钥将全部删除，<span className="font-semibold text-red-500">无法恢复</span>，账号也将被删除。请输入「{WIPE_CONFIRM_TEXT}」继续。
            </>
          }
          expected={WIPE_CONFIRM_TEXT}
          placeholder={WIPE_CONFIRM_TEXT}
          confirmText="下一步"
          destructive
          onConfirm={() => void startVerify()}
          onCancel={onClose}
        />
      )}

      {/* ③ 验证中：系统弹窗（Face ID / Hello）盖在这张卡片之上。
          本层没有取消入口 —— 验证由系统弹窗自己负责，用户在那里取消后会走上面的 alert 分支。 */}
      {step === 'verifying' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-8">
          <div
            className="w-full max-w-xs rounded-2xl bg-white px-5 py-6 text-center shadow-xl dark:bg-neutral-800"
            role="alertdialog"
            aria-label="正在验证身份"
          >
            <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">正在验证身份…</p>
            <p className="mt-2 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
              请完成系统指纹 / 面容 / Windows Hello 验证
            </p>
          </div>
        </div>
      )}

      {step === 'final' && (
        <ConfirmDialog
          title="确定删除全部数据？"
          message="这是最后一次确认。点击「删除」后，全部日记、通行密钥与恢复密钥会立即被清除，无法恢复。"
          confirmText="删除"
          cancelText="取消"
          destructive
          onConfirm={() => void wipe()}
          onCancel={onClose}
        />
      )}
    </div>
  )
}
