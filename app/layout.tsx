import type { Metadata, Viewport } from "next";
import SwRegister from "@/components/SwRegister";
import SecureContextCheck from "@/components/SecureContextCheck";
import AppFooter from "@/components/AppFooter";
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
      {/* flex 纵向布局：页面 flex-1 弹性分配，页脚在流内吸底（不遮挡任何内容） */}
      <body className="flex h-full flex-col bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        <SwRegister />
        <SecureContextCheck />
        <AppFooter />
      </body>
    </html>
  );
}
