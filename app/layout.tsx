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
  icons: { apple: [{ url: "/icons/icon-180.png", sizes: "180x180" }] },
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
      <body className="bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        {children}
        <SwRegister />
        <SecureContextCheck />
        <AppFooter />
      </body>
    </html>
  );
}
