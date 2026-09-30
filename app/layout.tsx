import type { Metadata, Viewport } from "next";
import SwRegister from "@/components/SwRegister";
import SecureContextCheck from "@/components/SecureContextCheck";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orbit",
  description: "Orbit",
  appleWebApp: { capable: true, title: "Orbit", statusBarStyle: "default" },
  manifest: "/manifest.webmanifest",
  // favicon 与桌面/PWA 图标同源（移除 Next 默认 favicon.ico）
  icons: {
    icon: "/icons/icon-192.png",
    apple: [{ url: "/icons/icon-180.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

// ★ 主题首帧防闪：必须在 paint 之前同步读出 qo-theme 并给 <html> 打类，
// 否则「深色/浅色」档会在首帧按系统色渲染、下一帧才切换（用户可见的闪白/闪黑）。
// 放在 <head> 里的同步 <script> 是唯一的时序保证（useLayoutEffect 在 hydration 之后，
// 已经晚于首帧）。内容与 lib/client/prefs.ts 的 applyTheme 必须保持一致：
//   dark → 加 .dark（当前 dark: 走系统媒体查询，此类的存在只为将来与显式标记对齐）
//   light → 加 .theme-light（globals.css 末尾的反向压制表靠它生效）
//   system → 两个类都不加（跟随 prefers-color-scheme）
// suppressHydrationWarning 已在 <html> 上，脚本改 classList 不会触发 hydration 警告。
const themeInitScript = `try{var t=localStorage.getItem('qo-theme');var e=document.documentElement;if(t==='dark'){e.classList.add('dark')}else if(t==='light'){e.classList.add('theme-light')}}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      {/* flex 纵向布局：页面 flex-1 弹性分配（高度链 app-height(100dvh) → wrapper flex-1、min-h-0）
          原全局页脚已由 (app)/layout.tsx 的 TabBar 取代；登录/初始化等组外页面各自吸底。
          ——不能加 mt-auto 页脚：它会让「容器高度 − 页脚」成为页面可视高度，而 TabBar 也在流内，
          两者叠加会把 (app) 页面压得比预期更矮。
          高度用 .app-height（100dvh）而非 h-full：iOS 上 100% 取的是含浏览器底部工具栏的
          「大视口」，会把贴底的元素（登录页版本页脚、TabBar）送进被系统覆盖的那一条里。 */}
      <body className="app-height flex flex-col bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        <SwRegister />
        <SecureContextCheck />
      </body>
    </html>
  );
}
