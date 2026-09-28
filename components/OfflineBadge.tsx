'use client'

import { useOffline } from '@/lib/client/use-offline'

// 离线指示：断网时顶部右侧的小胶囊（在线时不占任何空间）。
// 告诉用户「现在看到的是本地缓存、写下的内容会联网后同步」——没有这个指示，
// 离线保存成功的反馈（「已离线保存」）缺少上下文，用户不知道发生了什么。
// 纯实色底（项目铁律：零模糊属性），层级 z-40（低于 z-50 的弹窗/解锁提示）。
// 在线状态逻辑在 lib/client/use-offline.ts（与设置页的离线禁用共用同一 hook）。
export default function OfflineBadge() {
  const offline = useOffline()

  if (!offline) return null
  return (
    <div
      role="status"
      // 右对齐而非居中：left-1/2 + -translate-x-1/2 的水平居中在胶囊宽度为奇数时
      // 会产生半像素偏移，文字亚像素渲染发虚（用户实测「徽章被虚化」）；right 锚定
      // 无 transform，彻底规避。高度收紧：py-0.5 + leading-none（原 py-1 ≈ 23px → 现 ≈ 17px）。
      className="pointer-events-none fixed right-3 top-2 z-40 rounded-full bg-neutral-800 px-2.5 py-0.5 text-[10px] leading-none text-white dark:bg-neutral-200 dark:text-neutral-900"
    >
      离线模式
    </div>
  )
}
