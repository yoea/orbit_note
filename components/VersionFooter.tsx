// 版本页脚：版本号 + 版权（登录页与 UnlockPrompt 共用——两者是「同一界面元素的两份拷贝」，
// 版本页脚也是拷贝的一部分。曾只在登录页有：会话 cookie 30 天有效，PWA 冷启动大多落在
// UnlockPrompt 而不是 /login，用户因此长期「看不到版本号」，误判为注入链路 bug）。
//
// 两处都踩过坑，别再改回去：
// 1) 颜色不能用 text-neutral-300 dark:text-neutral-600 —— 这一对是「反的」：
//    浅色模式画的是给深色底用的浅灰（#d4d4d4 on #fff ≈ 1.5:1），深色模式画的是给浅色底
//    用的深灰（#525252 on #0a0a0a ≈ 2.5:1）。10px 小字在这个对比度下等于不可见，
//    桌面（大屏、近距离）勉强能看清，iPhone 上就是「没显示」。现在用 500/400：
//    浅色 4.7:1、深色 7.4:1，都过 WCAG AA 正文标准。
// 2) 底部留白由父级 main 的 .pb-safe（= max(env(safe-area-inset-bottom), 1rem)）承担，
//    不能用 .safe-pb（= env(...)）：后者在没有 home indicator 的设备/环境里算出来是 0，
//    页脚就会紧贴容器底边、落进系统覆盖区。父级 pb-safe 与这里的 pb-2 相加，
//    保证页脚文字始终离屏幕底边足够远。
export default function VersionFooter() {
  return (
    <footer className="pb-2 text-center text-[10px] text-neutral-500 dark:text-neutral-400" aria-hidden>
      Orbit {process.env.NEXT_PUBLIC_VERSION ?? 'dev'} · © 2026 {process.env.NEXT_PUBLIC_COPYRIGHT_NAME ?? 'Orbit'}
    </footer>
  )
}
