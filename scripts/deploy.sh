#!/bin/bash
# Quiet Orbit 一键部署（本地执行）
# 流程：同步代码 → 注入版本号 → 构建 → 打包 → 上传 → 远程更新（update.sh）→ 验证
# 用法：bash scripts/deploy.sh
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-/tmp/qo-prod}"
TARBALL="${TARBALL:-/tmp/quiet-orbit-prod.tar.gz}"
# 服务器信息从 .env.local 读取（不提交 git，见 .env.example 注释）：
#   REMOTE_HOST=myserver             # ~/.ssh/config 中的主机别名
#   REMOTE_UPDATE=/path/to/update.sh # 服务器端更新脚本绝对路径
# 也可用环境变量覆盖（export REMOTE_HOST=...）
if [ -f "$PROJECT_DIR/.env.local" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_DIR/.env.local"
  set +a
fi
REMOTE_HOST="${REMOTE_HOST:?请在 .env.local 中设置 REMOTE_HOST（ssh 主机别名）}"
REMOTE_TAR="/tmp/quiet-orbit-prod.tar.gz"
REMOTE_UPDATE="${REMOTE_UPDATE:?请在 .env.local 中设置 REMOTE_UPDATE（服务器端 update.sh 绝对路径）}"

echo "=== [1/7] 同步代码到构建目录 ==="
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
tar --exclude=node_modules --exclude=.next --exclude=.env.local --exclude=.env --exclude=.git -czf - -C "$PROJECT_DIR" . | tar -xzf - -C "$BUILD_DIR"
echo "代码已同步"

echo "=== [2/7] 版本号（git describe → 最近 tag） ==="
VERSION="$(git -C "$PROJECT_DIR" describe --tags --abbrev=0 --always)"
echo "$VERSION" > "$BUILD_DIR/.version"
echo "版本：$VERSION"

echo "=== [3/7] 安装依赖 + 生产构建 ==="
cd "$BUILD_DIR"
npm ci --no-audit --no-fund 2>&1 | tail -1
cp "$PROJECT_DIR/.env.local" .env
npm run build 2>&1 | tail -3
npm prune --omit=dev 2>&1 | tail -1
rm -f .env

echo "=== [4/7] 打包产物 ==="
tar --exclude=.env --exclude=.git --exclude=.next/cache -czf "$TARBALL" .
ls -lh "$TARBALL"

echo "=== [5/7] 上传到服务器 ==="
scp -o ConnectTimeout=25 "$TARBALL" "$REMOTE_HOST:$REMOTE_TAR"

echo "=== [6/7] 远程更新（解压 + pm2 restart + 验证） ==="
ssh -o ConnectTimeout=25 "$REMOTE_HOST" "bash $REMOTE_UPDATE $REMOTE_TAR"

echo "=== [7/7] 部署完成 ==="
