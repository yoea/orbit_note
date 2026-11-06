'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { getAvatarSrc, getProfileCreatedAt, getUserName, loadUserName, subscribeProfile } from './profile'

// 读取用户资料（库里没有名字会自动生成默认名并落库）。
// 订阅式：改名 / 换头像后所有展示位置立即刷新。
// 未解锁或请求失败时 name 为 null——调用方按「无名字」降级渲染，绝不阻塞页面。
//
// avatarSrc = 稳定同源 URL（/api/avatar?v=<version>）。版本号同步存在 localStorage，
// 首帧就能拼出来；图片由浏览器按 immutable 头缓存，只有换图（version 变）才重新加载。
const noAvatarSrc = () => null

export function useProfile(): {
  name: string | null
  createdAt: string | null
  avatarSrc: string | null
} {
  const name = useSyncExternalStore(subscribeProfile, getUserName, getUserName)
  const createdAt = useSyncExternalStore(subscribeProfile, getProfileCreatedAt, getProfileCreatedAt)
  // ★ 第三参固定返回 null：hydration 期间用的是服务端 HTML（里面没有头像），
  //   客户端不能在这时读出 localStorage 的版本号，否则 React 判定 hydration 不一致。
  //   hydration 结束后 React 立刻改用 getAvatarSrc 重取一次 ⇒ 紧接着切到缓存图，
  //   不会再等 /api/profile 网络往返（那才是原来「闪一下」的真正来源）。
  const avatarSrc = useSyncExternalStore(subscribeProfile, getAvatarSrc, noAvatarSrc)
  useEffect(() => {
    if (name) return
    // loadUserName 成功后写入缓存并通知订阅者，这里无需 setState
    void loadUserName().catch(() => { /* 未解锁 / 网络失败：保持 null */ })
  }, [name])
  return { name, createdAt, avatarSrc }
}

// 只要名字的轻量入口（大多数展示位置够用）
export function useUserName(): string | null {
  return useProfile().name
}
