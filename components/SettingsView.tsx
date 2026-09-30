'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ConfirmDialog from '@/components/ConfirmDialog'
import AboutDialog from '@/components/AboutDialog'
import PrefsDialog from '@/components/PrefsDialog'
import PasskeysDialog, { type PasskeyInfo } from '@/components/PasskeysDialog'
import RecoveryRegenerateDialog from '@/components/RecoveryRegenerateDialog'
import NameEditDialog from '@/components/NameEditDialog'
import ProfileCard from '@/components/ProfileCard'
import Toast from '@/components/Toast'
import { clearDek } from '@/lib/client/session'
import { clearUserNameCache } from '@/lib/client/profile'
import { useUserName } from '@/lib/client/use-user-name'
import { useOffline } from '@/lib/client/use-offline'

// 设置视图（原生路由页 /settings 渲染；DEK 会话级持久化，导航/重载自动恢复）
// 偏好开关已独立到 /settings/prefs，本页只保留一个入口——那一组占页高约 40%，
// 移出后本页一屏即可放下，不再需要滚动。
//
// 离线权限：导出 / 改昵称 / 改恢复密钥 / 改通行密钥 / 改偏好设置 / 退出登录都依赖
// 服务器写操作或需拉取服务器数据，离线时置灰并提示「该功能离线模式暂不可用」——
// 与其让用户点进去撞一次「保存失败」，不如入口处就说明白。「关于」不受限（纯本地只读）。
// 退出登录为何也禁：其本质是撤销服务器会话（POST /api/auth/logout），离线发不出去；
// 且退出后的 router.replace('/login') 软导航离线必失败，会误触发根级错误页「页面出错了」
// （真机实测）。要离开应用直接划掉即可——DEK 只在内存，重开自然回到解锁态。
export default function SettingsView() {
  const router = useRouter()
  const offline = useOffline()
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [showPrefs, setShowPrefs] = useState(false)
  const [showPasskeys, setShowPasskeys] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)
  const [showNameEdit, setShowNameEdit] = useState(false)
  // 离线禁用提示：offlineToastAt 是触发计数器（>0 即显示）。连点自增 →
  // 下面的 effect 重启 2s 计时器（toast 动画重放）；比手写 setTimeout+ref 简单且无 lint 争议
  const [offlineToastAt, setOfflineToastAt] = useState(0)

  useEffect(() => {
    if (!offlineToastAt) return
    const t = setTimeout(() => setOfflineToastAt(0), 2000)
    return () => clearTimeout(t)
  }, [offlineToastAt])

  function notifyOffline() {
    setOfflineToastAt((n) => n + 1)
  }

  // 离线守卫：离线时弹提示，在线时执行原动作
  function guard(action: () => void) {
    return () => {
      if (!offline) { action(); return }
      notifyOffline()
    }
  }

  // 离线置灰样式（视觉禁用；点击仍触发——弹提示比无声置灰更友好）
  const disabledClass = offline ? 'opacity-50' : ''

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
    <main className="animate-fade-in mx-auto h-full w-full max-w-md overflow-y-auto px-5 pb-4 safe-pt">
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
      <ProfileCard onEditName={guard(() => setShowNameEdit(true))} disabled={offline} />
      <p className="px-1 pb-2 pt-5 text-xs font-medium text-neutral-500 dark:text-neutral-400">安全</p>
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-neutral-50/60 dark:divide-neutral-800 dark:bg-neutral-900/40">
        <li>
          {/* 点击查看各设备通行密钥，可禁用/启用指定设备、添加新设备（先预取数据再打开，无加载闪烁）。
              离线禁用：列表与增删都依赖服务器 */}
          <button onClick={guard(() => void openPasskeysDialog())} className={`flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60 ${disabledClass}`}>
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">{userName ? `${userName}的通行密钥` : '通行密钥'}</p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">指纹 / Face ID / Windows Hello 等</p>
            </div>
            <span className="text-lg text-neutral-500 dark:text-neutral-400">›</span>
          </button>
        </li>
        <li>
          {/* 重新生成恢复密钥：弹窗完成（不再跳转独立页面）。离线禁用：重生成是服务器写操作 */}
          <button onClick={guard(() => setShowRecovery(true))} className={`flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60 ${disabledClass}`}>
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">重新生成恢复密钥</p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">更换新的恢复密钥，旧密钥立即失效</p>
            </div>
            <span className="text-lg text-neutral-500 dark:text-neutral-400">›</span>
          </button>
        </li>
      </ul>
      {/* 通用：偏好设置入口 + 关于。合并成一组——两者各自都只有一行，
          分开会各带一个「只配一行」的分组标题，白占两处页高 */}
      <p className="px-1 pb-2 pt-5 text-xs font-medium text-neutral-500 dark:text-neutral-400">通用</p>
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-neutral-50/60 dark:divide-neutral-800 dark:bg-neutral-900/40">
        <li>
          {/* 偏好设置：弹窗（原先是跳转独立页 /settings/prefs——那组开关只占约 40% 页高，
              跳页多一次导航与返回，改为弹窗后设置页一屏容纳）。离线禁用：开关写操作走服务器同步 */}
          <button onClick={guard(() => setShowPrefs(true))} className={`flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60 ${disabledClass}`}>
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">偏好设置</p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">位置、天气、地点名与各项显示开关</p>
            </div>
            <span className="text-lg text-neutral-500 dark:text-neutral-400">›</span>
          </button>
        </li>
        <li>
          <button onClick={() => setShowAbout(true)} className="flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60">
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">关于 Orbit</p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">端到端加密的私人日记</p>
            </div>
            <span className="text-lg text-neutral-500 dark:text-neutral-400">›</span>
          </button>
        </li>
      </ul>
      <p className="px-1 pb-2 pt-5 text-xs font-medium text-neutral-500 dark:text-neutral-400">数据</p>
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-neutral-50/60 dark:divide-neutral-800 dark:bg-neutral-900/40">
        <li>
          {/* 导入笔记：把 JSON 备份包 / Day One / Journey 的文件写进服务器。
              离线禁用：写入必须走服务器（不像浏览可以先落本地队列）。拦截导航 + 提示 */}
          <Link
            href="/settings/import"
            onClick={(e) => { if (offline) { e.preventDefault(); notifyOffline() } }}
            className={`flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60 ${disabledClass}`}
          >
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">导入笔记</p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">从 JSON 备份包或 Day One / Journey 文件恢复</p>
            </div>
            <span className="text-lg text-neutral-500 dark:text-neutral-400">›</span>
          </Link>
        </li>
        <li>
          {/* 导出笔记：解密后拼 JSON / CSV。离线禁用：导出需要拉取服务器全量日记密文
              （本地缓存不保证完整）。拦截导航 + 提示 */}
          <Link
            href="/settings/export"
            onClick={(e) => { if (offline) { e.preventDefault(); notifyOffline() } }}
            className={`flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60 ${disabledClass}`}
          >
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">导出笔记</p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">解密全部日记为 JSON 备份包或 CSV</p>
            </div>
            <span className="text-lg text-neutral-500 dark:text-neutral-400">›</span>
          </Link>
        </li>
        <li>
          {/* 退出登录：离线禁用（见文件头注释——服务器会话撤不掉，且导航离线必失败） */}
          <button onClick={guard(() => setConfirmLogout(true))} className={`flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60 ${disabledClass}`}>
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">退出登录</p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">退出后需重新验证通行密钥才能解锁</p>
            </div>
            <span className="text-lg text-neutral-500 dark:text-neutral-400">›</span>
          </button>
        </li>
      </ul>
      {/* 底部留白由 main 的 pb-4 承担（与其他 (app) 页面统一）。
          这里原先放了一个 <div className="h-10" aria-hidden /> 和更早的 Orbit 字标：
          字标当初用来给「关于 Orbit」留间隔，该行已移入「通用」分组；字标移除后改用了 h-10 占位，
          但 40px 与写页/详情页/列表页的 16px 不一致，会让同一位置的间距随页面漂移。
          统一到 main 的 pb-4 后，这里不再需要占位元素。 */}
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
      {/* 离线禁用提示（点击被禁入口时短暂显示） */}
      {offlineToastAt > 0 && <Toast message="该功能离线模式暂不可用" />}
    </main>
  )
}
