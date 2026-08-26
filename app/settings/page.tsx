'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { clearDek, fetchSession } from '@/lib/client/session'
import { idbClearAll } from '@/lib/client/idb'

// 定位开关（与 DiaryEditor 的 isLocationEnabled 共用 localStorage key）
const LOCATION_KEY = 'qo-location-enabled'

export default function SettingsPage() {
  const router = useRouter()
  const [info, setInfo] = useState<{ credentialCount: number; prfWrappers: number } | null>(null)
  const [locationEnabled, setLocationEnabled] = useState(true)

  useEffect(() => {
    void fetchSession().then((s) => setInfo({ credentialCount: s.credentialCount, prfWrappers: s.prfWrappers })).catch(() => setInfo(null))
    // 读取定位开关（默认开启）
    try {
      setLocationEnabled(localStorage.getItem(LOCATION_KEY) !== '0')
    } catch { /* localStorage 不可用则保持默认 */ }
  }, [])

  function toggleLocation() {
    const next = !locationEnabled
    setLocationEnabled(next)
    try {
      localStorage.setItem(LOCATION_KEY, next ? '1' : '0')
    } catch { /* 忽略存储失败（隐私模式等） */ }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    clearDek()
    router.replace('/login')
  }

  async function wipe() {
    if (!window.confirm('确定删除所有数据吗？此操作不可恢复！\n\n请先确认已保存你的恢复密钥。')) return
    if (!window.confirm('再次确认：所有日记、密钥包装、Passkey 凭证都将被永久删除。')) return
    try {
      const res = await fetch('/api/admin/wipe', { method: 'POST' })
      if (!res.ok) throw new Error()
      await idbClearAll()
      clearDek()
      router.replace('/setup')
    } catch {
      window.alert('删除失败，请重试')
    }
  }

  return (
    <main className="min-h-dvh px-5 safe-pt safe-pb">
      <header className="flex items-center justify-between py-3">
        <Link href="/" className="text-neutral-400">‹ 返回</Link>
        <h1 className="text-lg font-semibold">设置</h1>
        <span className="w-8" />
      </header>
      <ul className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
        <li className="flex items-center justify-between py-4">
          <span className="text-neutral-800 dark:text-neutral-200">Passkey</span>
          <span className="text-sm text-neutral-400">已启用（{info ? info.credentialCount : '—'} 个）</span>
        </li>
        <li className="py-4"><Link href="/settings/passkey" className="text-neutral-800 dark:text-neutral-200">注册新的 Passkey</Link></li>
        <li className="flex items-center justify-between py-4">
          <div>
            <p className="text-neutral-800 dark:text-neutral-200">保存时记录位置</p>
            <p className="mt-0.5 text-xs text-neutral-400">关闭后保存日记不再请求定位</p>
          </div>
          <button
            onClick={toggleLocation}
            role="switch"
            aria-checked={locationEnabled}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${locationEnabled ? 'bg-neutral-900 dark:bg-neutral-100' : 'bg-neutral-300 dark:bg-neutral-700'}`}
          >
            {/* 圆点：left-0.5(2px) 基础偏移 + 开启时 translate-x-5(20px) → 22+24=46px ≤ 48px 不溢出 */}
            <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${locationEnabled ? 'translate-x-5' : ''}`} />
          </button>
        </li>
        <li className="py-4"><Link href="/settings/recovery?mode=regenerate" className="text-neutral-800 dark:text-neutral-200">重新生成恢复密钥</Link></li>
        <li className="py-4"><button onClick={() => void logout()} className="text-neutral-800 dark:text-neutral-200">退出登录</button></li>
        <li className="py-4"><button onClick={() => void wipe()} className="text-red-500">删除所有数据</button></li>
        <li className="py-4 text-sm text-neutral-400">关于：端到端加密私人日记 · v0.1</li>
      </ul>
    </main>
  )
}
