// CSP：生产严格，开发放宽（HMR 需要 ws:/unsafe-eval）。
// script-src 必须含 'unsafe-inline'：Next.js 预渲染产物含内联 self.__next_f RSC flight 脚本
// （.next/server/app/index.html 实证），无 nonce 的官方配置即 'self' 'unsafe-inline'。
// XSS 防护主要依赖零 dangerouslySetInnerHTML + React 默认文本渲染（见 docs/security-audit.md）。
// connect-src 放行 BigDataCloud（地点名反查，含 307 重定向目标 api-bdc.io——
// 两个域名都必须放行）。天气经服务器代理，无需放行外部域名。
const CSP_CONNECT = "connect-src 'self' https://api.bigdatacloud.net https://api-bdc.io"

// ★ img-src 必须放行 OSS 域名（2026-11-04 事故，排查了一整轮）。
//   头像存在阿里云 OSS 的**私有 bucket**，页面用服务端签发的临时 URL 直接 <img> 显示。
//   而 img-src 原先只有 `'self' data:` —— OSS 域名不在白名单，浏览器**直接拒绝加载**，
//   表现是 <img> 一律 onError、界面显示「头像加载失败」。
//   最迷惑的地方：上传走同源 /api/avatar（受 connect-src 管，一直是通的），
//   命令行/服务端测签名 URL 也全是 200 —— 只有浏览器会因为 CSP 静默失败。
//   域名从 env 拼：换 bucket / region 时这里自动跟着变，不用改代码。
const OSS_BUCKET_NAME = process.env.OSS_BUCKET?.trim()
const OSS_REGION_NAME = process.env.OSS_REGION?.trim()
const OSS_IMG_SRC =
  OSS_BUCKET_NAME && OSS_REGION_NAME
    ? ` https://${OSS_BUCKET_NAME}.${OSS_REGION_NAME}.aliyuncs.com`
    : ''
// 图片源：本站 + data:（内联图标）+ OSS（头像）
const CSP_IMG = `img-src 'self' data:${OSS_IMG_SRC}`

export function securityHeaders(): Record<string, string> {
  const dev = process.env.NODE_ENV !== 'production'
  return {
    'Content-Security-Policy': dev
      ? `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; ${CSP_IMG}; ${CSP_CONNECT} ws:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
      : `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; ${CSP_IMG}; ${CSP_CONNECT}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
  }
}
