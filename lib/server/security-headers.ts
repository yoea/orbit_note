// CSP：生产严格，开发放宽（HMR 需要 ws:/unsafe-eval）。
// script-src 必须含 'unsafe-inline'：Next.js 预渲染产物含内联 self.__next_f RSC flight 脚本
// （.next/server/app/index.html 实证），无 nonce 的官方配置即 'self' 'unsafe-inline'。
// XSS 防护主要依赖零 dangerouslySetInnerHTML + React 默认文本渲染（见 docs/security-audit.md）。
export function securityHeaders(): Record<string, string> {
  const dev = process.env.NODE_ENV !== 'production'
  return {
    'Content-Security-Policy': dev
      ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
      : "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
  }
}
