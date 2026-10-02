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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      {/* flex 纵向布局：页面 flex-1 弹性分配（高度链 app-height(100dvh) → wrapper flex-1、min-h-0）
          原全局页脚已由 (app)/layout.tsx 的 TabBar 取代；登录/初始化等组外页面各自吸底。
          ——不能加 mt-auto 页脚：它会让「容器高度 − 页脚」成为页面可视高度，而 TabBar 也在流内，
          两者叠加会把 (app) 页面压得比预期更矮。
          高度用 .app-height（100dvh）而非 h-full：iOS 上 100% 取的是含浏览器底部工具栏的
          「大视口」，会把贴底的元素（登录页版本页脚、TabBar）送进被系统覆盖的那一条里。 */}
      <body className="app-height flex flex-col bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        {/* ★ App 根元素（2026-10-02 修「顶部渐隐」的关键）。
            它必须是「fixed + 实色底」的盒子，才能让 WebKit 关掉 iOS 26 的**顶部滚动边缘效果**
            （那条渐隐 = 渐变纱 + 微弱模糊）。判据与理由见 globals.css 里 .qo-app-root 的注释。
            独立窗口下额外给它 position:fixed + inset:0（布局本来就是满屏一列，尺寸不变）——
            这样顶边被一个「固定 + 实色」的盒子盖住，且高度 = 视口，满足 ≥10px 的最小要求。 */}
        <div className="qo-app-root flex min-h-0 flex-1 flex-col bg-white dark:bg-neutral-950">{children}</div>
        <SwRegister />
        <SecureContextCheck />
      </body>
    </html>
  );
}
