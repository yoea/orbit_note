// 全局吸底页脚：版本号 + 版权信息，所有页面（含登录/初始化）自动显示。
// 流内布局（body flex-col 中 mt-auto 吸底）——不遮挡任何页面内容，无需 fixed/calc。
export default function AppFooter() {
  return (
    <footer className="mt-auto border-t border-neutral-100 py-2 pb-safe text-center text-[10px] text-neutral-300 dark:border-neutral-800 dark:text-neutral-600" aria-hidden>
      Orbit {process.env.NEXT_PUBLIC_VERSION ?? 'dev'} · © 2026 Ethan
    </footer>
  )
}
