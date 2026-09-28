'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { getProfileCreatedAt, getUserName, loadUserName, subscribeProfile } from './profile'

// 读取用户资料（库里没有名字会自动生成默认名并落库）。
// 订阅式：改名后所有展示位置立即刷新。
// 未解锁或请求失败时 name 为 null——调用方按「无名字」降级渲染，绝不阻塞页面。
export function useProfile(): { name: string | null; createdAt: string | null } {
  const name = useSyncExternalStore(subscribeProfile, getUserName, getUserName)
  const createdAt = useSyncExternalStore(subscribeProfile, getProfileCreatedAt, getProfileCreatedAt)
  useEffect(() => {
    if (name) return
    // loadUserName 成功后写入缓存并通知订阅者，这里无需 setState
    void loadUserName().catch(() => { /* 未解锁 / 网络失败：保持 null */ })
  }, [name])
  return { name, createdAt }
}

// 只要名字的轻量入口（大多数展示位置够用）
export function useUserName(): string | null {
  return useProfile().name
}
