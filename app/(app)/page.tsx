'use client'

import DiaryEditor from '@/components/DiaryEditor'

// 解锁守卫、未解锁提示、连接失败提示统一在 (app)/layout.tsx 处理。
export default function HomePage() {
  return <DiaryEditor />
}
