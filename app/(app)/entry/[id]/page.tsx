'use client'

import { useParams } from 'next/navigation'
import EntryView from '@/components/EntryView'

// 解锁守卫统一在 (app)/layout.tsx 处理。
export default function EntryPage() {
  const { id } = useParams<{ id: string }>()
  return <EntryView id={id} />
}
