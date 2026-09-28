import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { NextConfig } from 'next'

// 版本号注入（设置页"关于"显示）：
// 优先级：1) NEXT_PUBLIC_VERSION 环境变量  2) .version 文件（部署打包时写入——
//         构建目录不含 .git，需显式提供）  3) git describe（最近 tag，本地构建）
// 4) fallback 'dev'。
// 统一附加构建时间戳（月日时分，如 v1.6.0.8301532）：同一 tag 多次构建可精确区分
function getVersion(): string {
  let base: string
  if (process.env.NEXT_PUBLIC_VERSION) {
    base = process.env.NEXT_PUBLIC_VERSION
  } else {
    try {
      const v = readFileSync('.version', 'utf8').trim()
      if (v) { base = v; }
      else throw new Error('empty')
    } catch {
      try {
        base = execSync('git describe --tags --abbrev=0 --always', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      } catch {
        base = 'dev'
      }
    }
  }
  const now = new Date()
  const stamp = `${now.getMonth() + 1}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  return `${base}.${stamp}`
}

// 构建时曾注入 NEXT_PUBLIC_COMMIT_ID 并在「关于」弹窗展示——已移除：
// NEXT_PUBLIC_* 会被内联进公开可下载的客户端 JS chunk，任何访客都能从静态资源里
// 读到精确 commit id，帮助攻击者把线上版本与仓库提交精确对号。版本号（tag + 构建时间戳）
// 是有意公开的，保留；commit id 属于额外暴露。服务器侧如需定位版本，看 APP_DIR/.version。
const nextConfig: NextConfig = {
  // 去掉 X-Powered-By: Next.js 响应头（默认携带，纯指纹信息，无任何功能作用）
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_VERSION: getVersion(),
  },
  // /api/* 不在 proxy 的 matcher 内（避免中间件介入每个 API 请求），因此拿不到那套安全头。
  // 对 JSON 响应而言真正有意义的是 nosniff：阻止浏览器忽略声明的内容类型去嗅探，
  // 避免响应体被当作 HTML/脚本解释。在这里按路径声明，新增 API 路由自动覆盖。
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }],
      },
    ];
  },
};

export default nextConfig;
