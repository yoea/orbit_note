'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ConfirmDialog from '@/components/ConfirmDialog'
import AboutDialog from '@/components/AboutDialog'
import PrefsDialog from '@/components/PrefsDialog'
import PasskeysDialog, { type PasskeyInfo } from '@/components/PasskeysDialog'
import RecoveryRegenerateDialog from '@/components/RecoveryRegenerateDialog'
import NameEditDialog from '@/components/NameEditDialog'
import ProfileCard from '@/components/ProfileCard'
import { clearDek } from '@/lib/client/session'
import { clearUserNameCache } from '@/lib/client/profile'
import { useUserName } from '@/lib/client/use-user-name'

// 设置视图（原生路由页 /settings 渲染；DEK 会话级持久化，导航/重载自动恢复）
// 偏好开关已独立到 /settings/prefs，本页只保留一个入口——那一组占页高约 40%，
// 移出后本页一屏即可放下，不再需要滚动。
export default function SettingsView() {
  const router = useRouter()
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [showPrefs, setShowPrefs] = useState(false)
  const [showPasskeys, setShowPasskeys] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)
  const [showNameEdit, setShowNameEdit] = useState(false)
  // 用户名（加密存服务器；库里没有会自动生成默认名 Orbit_xxx）
  const userName = useUserName()
  // 预取的 Passkey 列表：点击前 fetch 完成，弹窗打开第一帧即完整列表（无加载闪烁）
  const [passkeysData, setPasskeysData] = useState<PasskeyInfo[] | null>(null)

  // 先取数据再打开弹窗；fetch 失败也打开（弹窗内显示错误 + 重试）
  async function openPasskeysDialog() {
    try {
      const res = await fetch('/api/keys/passkeys')
      if (res.ok) {
        const data = await res.json() as { passkeys: PasskeyInfo[] }
        setPasskeysData(data.passkeys)
      } else {
        setPasskeysData(null)
      }
    } catch {
      setPasskeysData(null)
    }
    setShowPasskeys(true)
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    clearDek()
    clearUserNameCache() // 清掉会话内的名字缓存，避免下次解锁前泄漏
    router.replace('/login')
  }

  return (
    <main className="animate-fade-in mx-auto h-full w-full max-w-md overflow-y-auto px-5 safe-pt">
      {/* 电脑版与主页同宽（手机视图宽度），不随屏幕拉伸 */}
      {/* viewTransitionName：页面切换动画中页头保持固定（空间锚点） */}
      {/* 本页是 tab 目的地之一，不再放返回箭头（回首页由 TabBar 的「写」承担）；
          标题绝对居中，这里不需要右侧控件，故 justify-end + 空占位保持行高 */}
      <header className="page-header relative flex items-center justify-end py-3">
        <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold">设置</h1>
        <span className="w-8" aria-hidden />
      </header>
      {/* 个人信息卡片：生成式头像 + 名字 + 一行统计；点开改名。
          不设分组标题——卡片本身已足够表意，省掉一个只配一行的标题 */}
      <ProfileCard onEditName={() => setShowNameEdit(true)} />
      <p className="px-1 pb-2 pt-5 text-xs font-medium text-neutral-400">安全</p>
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-neutral-50/60 dark:divide-neutral-800 dark:bg-neutral-900/40">
        <li>
          {/* 点击查看各设备通行密钥，可禁用/启用指定设备、添加新设备（先预取数据再打开，无加载闪烁） */}
          <button onClick={() => void openPasskeysDialog()} className="flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60">
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">{userName ? `${userName}的通行密钥` : '通行密钥'}</p>
              <p className="mt-0.5 text-xs text-neutral-400">指纹 / Face ID / Windows Hello 等</p>
            </div>
            <span className="text-lg text-neutral-300">›</span>
          </button>
        </li>
        <li>
          {/* 重新生成恢复密钥：弹窗完成（不再跳转独立页面） */}
          <button onClick={() => setShowRecovery(true)} className="flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60">
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">重新生成恢复密钥</p>
              <p className="mt-0.5 text-xs text-neutral-400">更换新的恢复密钥，旧密钥立即失效</p>
            </div>
            <span className="text-lg text-neutral-300">›</span>
          </button>
        </li>
      </ul>
      {/* 通用：偏好设置入口 + 关于。合并成一组——两者各自都只有一行，
          分开会各带一个「只配一行」的分组标题，白占两处页高 */}
      <p className="px-1 pb-2 pt-5 text-xs font-medium text-neutral-400">通用</p>
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-neutral-50/60 dark:divide-neutral-800 dark:bg-neutral-900/40">
        <li>
          {/* 偏好设置：弹窗（原先是跳转独立页 /settings/prefs——那组开关只占约 40% 页高，
              跳页多一次导航与返回，改为弹窗后设置页一屏容纳） */}
          <button onClick={() => setShowPrefs(true)} className="flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60">
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">偏好设置</p>
              <p className="mt-0.5 text-xs text-neutral-400">位置、天气、地点名与各项显示开关</p>
            </div>
            <span className="text-lg text-neutral-300">›</span>
          </button>
        </li>
        <li>
          <button onClick={() => setShowAbout(true)} className="flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60">
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">关于 Orbit</p>
              <p className="mt-0.5 text-xs text-neutral-400">端到端加密的私人日记，只为一个人服务</p>
            </div>
            <span className="text-lg text-neutral-300">›</span>
          </button>
        </li>
      </ul>
      <p className="px-1 pb-2 pt-5 text-xs font-medium text-neutral-400">数据</p>
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-neutral-50/60 dark:divide-neutral-800 dark:bg-neutral-900/40">
        <li>
          <Link href="/settings/export" className="flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60">
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">导出笔记</p>
              <p className="mt-0.5 text-xs text-neutral-400">解密全部日记为 CSV 文件</p>
            </div>
            <span className="text-lg text-neutral-300">›</span>
          </Link>
        </li>
        <li>
          <button onClick={() => setConfirmLogout(true)} className="flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60">
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">退出登录</p>
              <p className="mt-0.5 text-xs text-neutral-400">退出后需重新验证通行密钥才能解锁</p>
            </div>
            <span className="text-lg text-neutral-300">›</span>
          </button>
        </li>
      </ul>
      {/* 底部留白：避免最后一组卡片紧贴 TabBar。
          这里原先放了一个 Orbit 字标，但它当初的作用是给「关于 Orbit」留出与页脚的间隔——
          该行已移入「通用」分组，而全局页脚已由 TabBar 取代（版本号与版权在「关于」弹窗里本来就有），
          再放一个字标既重复、又正好压在 TabBar 上方，故移除 */}
      <div className="h-10" aria-hidden />
      {confirmLogout && (
        <ConfirmDialog
          title={userName ? `确定退出 ${userName} 的登录吗？` : '确定退出登录吗？'}
          message="退出后需重新验证通行密钥才能解锁日记。"
          confirmText="退出"
          cancelText="取消"
          onConfirm={() => { setConfirmLogout(false); void logout() }}
          onCancel={() => setConfirmLogout(false)}
        />
      )}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      {showPrefs && <PrefsDialog onClose={() => setShowPrefs(false)} />}
      {showPasskeys && (
        <PasskeysDialog initialData={passkeysData} onClose={() => setShowPasskeys(false)} />
      )}
      {showRecovery && <RecoveryRegenerateDialog onClose={() => setShowRecovery(false)} />}
      {showNameEdit && userName && (
        <NameEditDialog current={userName} onSaved={() => setShowNameEdit(false)} onClose={() => setShowNameEdit(false)} />
      )}
    </main>
  )
}
