import { execSync } from 'node:child_process'
import type { NextConfig } from 'next'

// 构建时注入当前 commit id（设置页"关于"显示版本号；失败时回退 'dev'）
function getCommitId(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_COMMIT_ID: getCommitId(),
  },
};

export default nextConfig;
