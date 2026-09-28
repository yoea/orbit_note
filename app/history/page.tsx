import { redirect } from 'next/navigation'

// 旧路由兼容：/history → /diary（页面已重构为「全部日记」）
export default function HistoryRedirectPage() {
  redirect('/diary')
}
