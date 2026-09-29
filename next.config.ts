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
  // 自包含产物：构建时把「运行时真正需要的」那部分 node_modules 追踪出来，
  // 连同 server.js 一起放进 .next/standalone。
  //
  // 为什么要这个（2026-09-29 真实事故）：线上服务器 CPU 与磁盘很弱且带 BPS 限速。
  // 旧流程的上传包不含 node_modules，代价是「lockfile 变化时由服务器端 update.sh 跑
  // npm ci --omit=dev」——某次功能带进 84 个包，第一次真正触发，直接把线上 IO 打满，
  // 站点与 SSH 全部不可达，最后靠硬重启才恢复。
  // 换成 standalone 后：服务器只做「顺序解包 + node server.js」，**永不装依赖、永不构建**。
  //
  // 注意：standalone **不会**自动带上 .next/static 与 public，必须由部署脚本复制进去
  // （scripts/deploy.sh 的 [5/8] 打包步骤负责，见那里的注释）。
  output: 'standalone',
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
      // HTML 页面显式 no-cache：Next 给预渲染页的默认头是 s-maxage=31536000（仅对 CDN
      // 生效），浏览器侧新鲜度「未指定」——iOS Safari / PWA 的 WKWebView 会对这种页面
      // 做启发式缓存，直接用本地旧副本不发协商请求，部署新版后手机上表现为「改了但没变」
      // （真实事故：v1.15.5 修好的登录页页脚在 iOS 上"又消失"）。no-cache = 每次带 ETag
      // 协商：内容没变是廉价 304，变了立即拿新页。必须逐路径枚举——不能写 '/:path*'，
      // 否则会把 /_next/static/ 指纹资源的 immutable 长缓存也覆盖掉。
      // 新增页面路由时这里要同步登记。
      ...[
        { source: '/' },
        { source: '/login' },
        { source: '/setup' },
        { source: '/diary' },
        { source: '/entry/:id' },
        { source: '/settings/:path*' },
      ].map((p) => ({
        ...p,
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      })),
    ];
  },
};

export default nextConfig;
