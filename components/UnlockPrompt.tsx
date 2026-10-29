'use client'

import { useState } from 'react'
import OrbitLogo from './OrbitLogo'
import VersionFooter from './VersionFooter'
import { BRAND_GRADIENT_CLASS, PRIMARY_BUTTON_CLASS } from '@/lib/client/ui'

// 手动解锁入口（留在当前页）；单次认证完成登录+解锁。
// 点击后立即唤起系统通行密钥弹窗（userVerification: discouraged——不自动识别，
// 用户点击通行密钥后由系统决定是否 Face ID）。
export default function UnlockPrompt({ onUnlock }: { onUnlock: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUnlock() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const err = await onUnlock() // 立即唤起系统通行密钥弹窗
      if (err) setError(err)
    } catch {
      setError('解锁失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col px-6 pb-safe">
      {/* m-auto：LOGO + 按钮整体垂直居中。底部留白用 .pb-safe（= max(env, 1rem)）：
          登录页 v1.15.5 换掉 .safe-pb 时这里漏了——safe-pb 在无 home indicator 的
          环境里算出来是 0，内容会贴到容器底边、落进 iOS 工具栏覆盖区。 */}
      <div className="m-auto flex w-full max-w-xs flex-col items-center gap-8">
        {/* 品牌标识：与登录页逐字相同（LOGO + 一句话，12px 内距 / 与按钮区 32px），
            结构说明见 app/login/page.tsx 同一块的注释。
            ★ 唯一的区别在**主按钮里**（2026-10-12 用户定稿）：锁图标 + 「解锁」；
              登录页是钥匙图标 + 「使用通行密钥登录」。身份标识**融进按钮**、
              不另占一行 —— 按钮是这一屏最大、最先被看到的元素，标在这里比挂在
              tagline 下面更容易被扫到，也少一个元素。
              ★ 改文案/图标时**两页必须同时看**：tests/login-unlock-identity.test.ts
              双向钉住「图标与词必须不同」，谁把两页抄成一样都会立刻变红。 */}
        <div className="flex flex-col items-center gap-3">
          <OrbitLogo size="lg" />
          <p className="text-center text-xs tracking-wide text-neutral-500 dark:text-neutral-400">
            端到端加密的私人日记。
          </p>
        </div>
        <div className="w-full">
          <button
            onClick={() => void handleUnlock()}
            disabled={busy}
            /* 尺寸/圆角/字号与写页「保存」**同一个来源**（PRIMARY_BUTTON_CLASS，
               2026-10-12 用户要求统一）：它原先在这里手写了一份「小一档」的串
               （py-3 / text-sm / rounded-xl），那正是 primary-button.test.ts 要防的漂移。
               额外加 flex + justify-center + gap-2：按钮默认的 text-align:center 只能居中
               纯文本，里面放了图标就必须自己排（否则图标贴左、文字居中会散开）。 */
            className={`${PRIMARY_BUTTON_CLASS} ${BRAND_GRADIENT_CLASS} flex items-center justify-center gap-2`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            {busy ? '正在解锁…' : '解锁'}
          </button>
          {/* 与登录页是同一个界面元素的两份拷贝：按钮下方那两行小字说明已一并删除，
              理由见 app/login/page.tsx 的注释。只改一处会立刻出现「同一次登录、
              两个页面文案不同」，以后要动这里记得两边同步。 */}
          {error && <p role="alert" className="mt-3 text-center text-sm text-red-500">{error}</p>}
        </div>
      </div>
      {/* 版本页脚与登录页同款（共享组件）：用户日常看到的「登录界面」其实是这里——
          会话 cookie 30 天有效，PWA 冷启动大多落在 UnlockPrompt 而非 /login，
          此前只有 /login 有版本行，造成「版本号一直不显示」的误报（真实事故）。 */}
      <VersionFooter />
    </main>
  )
}
