'use client'

// 全局错误边界：连根布局都挂掉时的最后兜底。
// 此时 globals.css 可能未生效，故一律用内联样式，且必须自带 html/body。
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, background: '#ffffff', color: '#171717', fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <div
          style={{
            display: 'flex',
            minHeight: '100vh',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '0 24px',
            textAlign: 'center',
          }}
        >
          <p style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>Orbit 暂时无法启动</p>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: '#a3a3a3' }}>
            你的日记没有丢失，重试即可。
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 16,
              border: 0,
              borderRadius: 12,
              padding: '12px 24px',
              fontSize: 14,
              fontWeight: 500,
              color: '#ffffff',
              background: 'linear-gradient(90deg, #f97316, #fb7185, #8b5cf6)',
            }}
          >
            重试
          </button>
          {error.digest && (
            <p style={{ margin: 0, fontSize: 10, color: '#d4d4d4' }}>诊断码 {error.digest}</p>
          )}
        </div>
      </body>
    </html>
  )
}
