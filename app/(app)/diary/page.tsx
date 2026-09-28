'use client'

import DiaryListView from '@/components/DiaryListView'

// 解锁守卫统一在 (app)/layout.tsx 处理。
export default function DiaryPage() {
  return <DiaryListView />
}
