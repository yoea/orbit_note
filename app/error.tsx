'use client'

import Link from 'next/link'

// 路由级错误边界：任意页面在渲染/副作用中抛错时兜底，避免白屏。
// PWA（standalone）里白屏尤其糟糕——没有地址栏、没有刷新按钮，用户只能杀进程重开。
// 注意：本组件内不做任何 console 输出（全项目安全审计要求）。
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex h-full w-full max-w-md flex-col items-center justify-center gap-4 px-5 safe-pt pb-safe">
      <p className="text-base font-medium text-neutral-800 dark:text-neutral-100">页面出错了</p>
      <p className="max-w-xs text-center text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
        你的日记没有被改动，重试一次通常就能继续。
      </p>
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={reset}
          className="rounded-xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-6 py-3 text-sm font-medium text-white active:scale-[0.98]"
        >
          重试
        </button>
        <Link
          href="/"
          className="rounded-xl bg-neutral-100 px-6 py-3 text-sm font-medium text-neutral-700 active:opacity-60 dark:bg-neutral-800 dark:text-neutral-200"
        >
          回首页
        </Link>
      </div>
      {/* 诊断码：与登录页的「诊断 no-dek」同风格，便于定位问题；不含任何内容信息。
          颜色与登录页版本页脚/关于弹窗版权行统一（原 text-neutral-300 dark:text-neutral-600
          是反的，浅色模式下 ≈1.5:1 等于看不见） */}
      {error.digest && <p className="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400">诊断码 {error.digest}</p>}
    </main>
  )
}
