'use client'

import { useEffect, useState } from 'react'

// 离线指示：断网时顶部居中的小胶囊（在线时不占任何空间）。
// 告诉用户「现在看到的是本地缓存、写下的内容会联网后同步」——没有这个指示，
// 离线保存成功的反馈（「已离线保存」）缺少上下文，用户不知道发生了什么。
// 纯实色底（项目铁律：零模糊属性），层级 z-40（低于 z-50 的弹窗/解锁提示）。
export default function OfflineBadge() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  if (!offline) return null
  return (
    <div
      role="status"
      className="pointer-events-none fixed left-1/2 top-3 z-40 -translate-x-1/2 rounded-full bg-neutral-800 px-3 py-1 text-[10px] font-medium text-white dark:bg-neutral-200 dark:text-neutral-900"
    >
      离线模式
    </div>
  )
}
