'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { clearDek, fetchSession } from '@/lib/client/session'
import { idbClearAll } from '@/lib/client/idb'

export default function SettingsPage() {
  const router = useRouter()
  const [info, setInfo] = useState<{ credentialCount: number; prfWrappers: number } | null>(null)

  useEffect(() => {
    void fetchSession().then((s) => setInfo({ credentialCount: s.credentialCount, prfWrappers: s.prfWrappers })).catch(() => setInfo(null))
  }, [])

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
        <li className="py-4"><Link href="/settings/recovery?mode=export" className="text-neutral-800 dark:text-neutral-200">导出恢复密钥</Link></li>
        <li className="py-4"><Link href="/settings/recovery?mode=regenerate" className="text-neutral-800 dark:text-neutral-200">重新生成恢复密钥</Link></li>
        <li className="py-4"><button onClick={() => void logout()} className="text-neutral-800 dark:text-neutral-200">退出登录</button></li>
        <li className="py-4"><button onClick={() => void wipe()} className="text-red-500">删除所有数据</button></li>
        <li className="py-4 text-sm text-neutral-400">关于：端到端加密私人日记 · v0.1</li>
      </ul>
    </main>
  )
}
