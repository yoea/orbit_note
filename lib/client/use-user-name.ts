'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { getUserName, loadUserName, subscribeUserName } from './profile'

// 读取当前用户名（库里没有会自动生成默认名并落库）。
// 订阅式：改名后所有显示名字的组件立即刷新。
// 未解锁或请求失败时返回 null——调用方按「无名字」降级渲染，绝不阻塞页面。
export function useUserName(): string | null {
  const name = useSyncExternalStore(subscribeUserName, getUserName, getUserName)
  useEffect(() => {
    if (name) return
    // loadUserName 成功后写入缓存并通知订阅者，这里无需 setState
    void loadUserName().catch(() => { /* 未解锁 / 网络失败：保持 null */ })
  }, [name])
  return name
}
