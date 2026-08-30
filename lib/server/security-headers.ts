// CSP：生产严格，开发放宽（HMR 需要 ws:/unsafe-eval）。
// script-src 必须含 'unsafe-inline'：Next.js 预渲染产物含内联 self.__next_f RSC flight 脚本
// （.next/server/app/index.html 实证），无 nonce 的官方配置即 'self' 'unsafe-inline'。
// XSS 防护主要依赖零 dangerouslySetInnerHTML + React 默认文本渲染（见 docs/security-audit.md）。
// connect-src 放行 BigDataCloud：客户端直调反查地点名（仅此一个第三方接口）。
// 注意：请求会被 307 重定向到 CDN 域名 api-bdc.io——两个域名都必须放行，否则 CSP 拦截重定向。
const CSP_CONNECT = "connect-src 'self' https://api.bigdatacloud.net https://api-bdc.io"
export function securityHeaders(): Record<string, string> {
  const dev = process.env.NODE_ENV !== 'production'
  return {
    'Content-Security-Policy': dev
      ? `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; ${CSP_CONNECT} ws:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
      : `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; ${CSP_CONNECT}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
  }
}
