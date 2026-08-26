// 全局吸底页脚：版本号 + 版权信息，所有页面（含登录/初始化）自动显示。
// fixed 底部定位；pointer-events-none 不拦截任何点击；半透明背景 + 毛玻璃。
export default function AppFooter() {
  return (
    <footer
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 border-t border-neutral-100 bg-white/80 py-2 text-center text-[10px] text-neutral-300 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80 dark:text-neutral-600"
      aria-hidden
    >
      <p className="pb-safe">
        Orbit {process.env.NEXT_PUBLIC_VERSION ?? 'dev'} · © 2026 Ethan
      </p>
    </footer>
  )
}
