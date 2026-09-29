'use client'

import { useEffect, useState } from 'react'

// 非安全上下文检测：WebCrypto（crypto.subtle）只在 Secure Context 可用。
// 通过 HTTP（非 localhost）访问时 crypto.subtle 为 undefined——显示友好提示而非崩溃。
export default function SecureContextCheck() {
  const [insecure, setInsecure] = useState(false)

  useEffect(() => {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      // 异步 setState（避免 react-hooks/set-state-in-effect 级联渲染警告）
      const timer = setTimeout(() => setInsecure(true), 0)
      return () => clearTimeout(timer)
    }
  }, [])

  if (!insecure) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white px-6 dark:bg-neutral-950">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">无法安全连接</h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
          此网站需要 HTTPS 安全连接才能使用加密功能（日记端到端加密依赖浏览器 WebCrypto API，仅限安全上下文）。
        </p>
        <p className="mt-2 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
          请通过 <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">https://</code> 地址访问（iPhone 请用 Safari 打开，局域网调试需配置 HTTPS 证书）。
        </p>
      </div>
    </div>
  )
}
