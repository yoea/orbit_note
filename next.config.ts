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

// 构建时注入当前 commit id（辅助信息）
function getCommitId(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'unknown'
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_VERSION: getVersion(),
    NEXT_PUBLIC_COMMIT_ID: getCommitId(),
  },
};

export default nextConfig;
