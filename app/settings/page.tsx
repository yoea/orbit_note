import { redirect } from 'next/navigation'

// 设置已并入首页视图状态机（避免 PWA 导航重载丢失解锁状态）；保留路由用于深链兜底
export default function SettingsPage() {
  redirect('/')
}
