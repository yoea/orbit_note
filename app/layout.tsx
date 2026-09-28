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
      {/* flex 纵向布局：页面 flex-1 弹性分配（高度链 html/body 100% → wrapper flex-1、min-h-0）
          原全局页脚已由 (app)/layout.tsx 的 TabBar 取代；登录/初始化等组外页面各自吸底。
          ——不能加 mt-auto 页脚：它会让「容器高度 − 页脚」成为页面可视高度，而 TabBar 也在流内，
          两者叠加会把 (app) 页面压得比预期更矮。 */}
      <body className="flex h-full flex-col bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        <SwRegister />
        <SecureContextCheck />
      </body>
    </html>
  );
}
