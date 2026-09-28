'use client'

import { useEffect, useState } from 'react'

// 在线状态 hook：navigator.onLine + online/offline 事件，状态变化自动重渲染。
// 仅供 UI 层使用（禁用入口、显示徽章）；业务决策（离线兜底读缓存等）仍以
// 「请求是否可达」为准——navigator.onLine 不可靠（连着 WiFi 但外网断了时是 true），
// 判断错了最多是 UI 显示不准，功能永不误判。
export function useOffline(): boolean {
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
  return offline
}
