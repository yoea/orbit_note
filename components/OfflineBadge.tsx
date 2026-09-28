'use client'

import { useOffline } from '@/lib/client/use-offline'

// 离线指示：断网时顶部居中的琥珀色小圆标（wifi-off 图标，在线时不占任何空间）。
// 告诉用户「现在看到的是本地缓存、写下的内容会联网后同步」——没有这个指示，
// 离线保存成功的反馈（「已离线保存」）缺少上下文，用户不知道发生了什么。
//
// 定位：fixed 水平居中（inset-x-0 + justify-center，无 transform——居中 transform 在
// 奇数宽度下产生半像素偏移导致发虚）；top 计入顶部安全区（刘海/灵动岛下方）。
// 页面内容让位：globals.css 的 .qo-offline .safe-pt 规则把 (app) 内所有页面顶部
// 下推 32px，徽标正好落在让出的空档里（居中的页标题上方）——不压标题。
// 纯实色底（项目铁律：零模糊属性），层级 z-40（低于 z-50 的弹窗/解锁提示）。
// 在线状态逻辑在 lib/client/use-offline.ts（与设置页的离线禁用共用同一 hook）。
export default function OfflineBadge() {
  const offline = useOffline()

  if (!offline) return null
  return (
    <div
      role="status"
      aria-label="离线模式"
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+8px)] z-40 flex justify-center"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-white">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
          aria-hidden
        >
          <path d="M12 20h.01" />
          <path d="M8.5 16.429a5 5 0 0 1 7 0" />
          <path d="M5 12.859a10 10 0 0 1 5.17-2.69" />
          <path d="M19 12.859a10 10 0 0 1 2.007-1.523" />
          <path d="M2 8.82a15 15 0 0 1 4.177-2.643" />
          <path d="M22 8.82a15 15 0 0 0-11.288-3.764" />
          <path d="m2 2 20 20" />
        </svg>
      </span>
    </div>
  )
}
