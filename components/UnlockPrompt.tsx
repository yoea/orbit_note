'use client'

import { useState } from 'react'
import OrbitLogo from './OrbitLogo'
import VersionFooter from './VersionFooter'

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
            结构说明见 app/login/page.tsx 同一块的注释 */}
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
            className="w-full rounded-2xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-6 py-4 text-base font-medium text-white active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? '正在验证…' : '使用通行密钥登录'}
          </button>
          {/* 与登录页是同一个界面元素的两份拷贝：按钮下方那两行小字说明已一并删除，
              理由见 app/login/page.tsx 的注释。只改一处会立刻出现「同一次登录、
              两个页面文案不同」，以后要动这里记得两边同步。 */}
          {error && <p className="mt-3 text-center text-sm text-red-500">{error}</p>}
        </div>
      </div>
      {/* 版本页脚与登录页同款（共享组件）：用户日常看到的「登录界面」其实是这里——
          会话 cookie 30 天有效，PWA 冷启动大多落在 UnlockPrompt 而非 /login，
          此前只有 /login 有版本行，造成「版本号一直不显示」的误报（真实事故）。 */}
      <VersionFooter />
    </main>
  )
}
