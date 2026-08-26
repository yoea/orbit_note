// CSP：生产严格，开发放宽（HMR 需要 ws:/unsafe-eval）
export function securityHeaders(): Record<string, string> {
  const dev = process.env.NODE_ENV !== 'production'
  return {
    'Content-Security-Policy': dev
      ? "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
  }
}
