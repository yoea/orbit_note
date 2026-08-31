'use client'

// 小型通知弹窗（toast）：iOS 风格顶部胶囊，短暂显示后由外层控制移除。
// 用于保存成功等轻量反馈——不打断操作、不占布局（fixed 悬浮）。
export default function Toast({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="animate-toast fixed left-1/2 top-10 z-[60] -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-4 py-2 text-sm font-medium text-white shadow-lg"
    >
      {message}
    </div>
  )
}
