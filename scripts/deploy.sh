#!/bin/bash
# Quiet Orbit 一键部署（本地执行）
# 流程：schema 检查 → 同步代码（复用依赖缓存）→ 构建 → 打包（不含 node_modules）→ 上传 → 远程更新 → 验证
# 用法：bash scripts/deploy.sh
#
# 性能设计（2026-09-28 大改，部署从 ~2m48s 降到 ~1min 内）：
#   1) BUILD_DIR（/tmp/qo-prod）常驻：node_modules 与 .next/cache 跨部署保留。
#      package-lock.json 未变化时跳过 npm ci（省 ~30s）；Turbopack 增量构建（省冷编译）。
#   2) 上传包只含 .next/public/package.json 等运行时文件，**不含 node_modules**
#      （原 95M/解压 771M → 现 ~10M）。依赖变化时由服务器端 update.sh 执行
#      npm ci --omit=dev（服务器已验证可直连 registry.npmjs.org）。
#   3) 服务器解压前 rm -rf .next —— 既消除孤儿 chunk 累积（曾累积 526 个文件/74M，
#      污染一切 grep 核验），也让 .next 体积恒定。
#
# 注意：必须带 pipefail——构建步骤用了 `cmd | tail -N`，否则管道退出码会被 tail 吞掉，
# 构建失败也会继续打包上传（曾导致线上 .next 未更新但 .version 已改的假成功）。
set -eo pipefail

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

T0=$(date +%s)
step() { echo "=== [$1] $2（累计 $(( $(date +%s) - T0 ))s） ==="; }

echo "=== [1/8] 生产库 schema 前置检查 ==="
# 迁移必须先在服务器上执行——deploy.sh / update.sh 都不跑迁移。
# 漏掉会出现「代码上线了但表/列不存在」的 500，且没有明显报错，很难排查，
# 因此这里做成硬失败（检查不通过即中止，不会白跑一次构建）。
# ssh 由本脚本执行、Node 只做解析比对：本机 Node 的 child_process 在受限环境里
# spawn 会 EBUSY（实测连 node -v / git --version 都起不来），不能交给 Node 内部再起 ssh。
if [ "${SKIP_SCHEMA_CHECK:-0}" = "1" ]; then
  echo "已跳过（SKIP_SCHEMA_CHECK=1）"
else
  REMOTE_APP_DIR="$(dirname "$REMOTE_UPDATE")"
  # 固定路径而非 mktemp：Git Bash 下 mktemp 可能返回带盘符的路径，清理时会报错
  SCHEMA_DUMP="/tmp/qo-schema-actual.txt"
  trap 'rm -f "$SCHEMA_DUMP"' EXIT
  if ! ssh -o ConnectTimeout=25 "$REMOTE_HOST" "APP_DIR='$REMOTE_APP_DIR' sh -s" \
      < "$PROJECT_DIR/scripts/schema-dump.sh" > "$SCHEMA_DUMP"; then
    echo "❌ 无法读取生产库 schema（ssh 或数据库查询失败）。" >&2
    echo "   如确认无需检查，可用 SKIP_SCHEMA_CHECK=1 bash scripts/deploy.sh 跳过。" >&2
    exit 1
  fi
  node "$PROJECT_DIR/scripts/check-schema.mjs" "$SCHEMA_DUMP"
fi

step "2/8" "同步代码到构建目录（保留依赖缓存）"
# BUILD_DIR 常驻：只清源码，保留 node_modules（依赖缓存）与 .next/cache（构建缓存）。
# .next 其余部分必须清掉——路由删除/改名后残留的 .next/types 会让构建报错（陈旧引用）。
mkdir -p "$BUILD_DIR"
CACHE_TMP=""
if [ -d "$BUILD_DIR/.next/cache" ]; then
  CACHE_TMP="/tmp/qo-next-cache.$$"
  mv "$BUILD_DIR/.next/cache" "$CACHE_TMP"
fi
find "$BUILD_DIR" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
if [ -n "$CACHE_TMP" ] && [ -d "$CACHE_TMP" ]; then
  mkdir -p "$BUILD_DIR/.next"
  mv "$CACHE_TMP" "$BUILD_DIR/.next/cache"
fi
# 同步源码（排除缓存/密钥/内部记录）
tar --exclude=node_modules --exclude=.next --exclude=.env.local --exclude=.env \
    --exclude=.git --exclude=.workbuddy -czf - -C "$PROJECT_DIR" . | tar -xzf - -C "$BUILD_DIR"
echo "代码已同步"

echo "=== [3/8] 版本号（git describe → 最近 tag） ==="
VERSION="$(git -C "$PROJECT_DIR" describe --tags --abbrev=0 --always)"
echo "$VERSION" > "$BUILD_DIR/.version"
echo "版本：$VERSION"

step "4/8" "安装依赖（lockfile 未变则复用缓存）+ 生产构建"
cd "$BUILD_DIR"
# --ignore-scripts：跳过依赖的 postinstall。带脚本的包（esbuild / fsevents /
# unrs-resolver 等）全部是 dev 或平台相关，生产运行与 next build 都不需要它们；
# 而 esbuild 的 install.js 在 Windows 上会因杀毒软件锁文件报 spawnSync EBUSY。
LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
DEPS_HASH_FILE="$BUILD_DIR/node_modules/.qo-deps-hash"
if [ ! -d node_modules ] || [ "$(cat "$DEPS_HASH_FILE" 2>/dev/null || true)" != "$LOCK_HASH" ]; then
  echo "依赖变化（或首次构建），npm ci…"
  npm ci --no-audit --no-fund --ignore-scripts 2>&1 | tail -1
  echo "$LOCK_HASH" > "$DEPS_HASH_FILE"
else
  echo "依赖未变化，跳过 npm ci（复用 $BUILD_DIR/node_modules）"
fi
cp "$PROJECT_DIR/.env.local" .env
npm run build 2>&1 | tail -3
# 构建产物硬校验：缺 BUILD_ID 说明 build 实际失败，立即中止，不要上传半成品
if [ ! -f .next/BUILD_ID ]; then
  echo "❌ 构建失败：.next/BUILD_ID 不存在。中止部署。"
  exit 1
fi
rm -f .env
# 注意：不再 npm prune——node_modules 不上传（留在本地缓存供下次构建，含 devDeps）

step "5/8" "打包产物（不含 node_modules，只带运行时必需文件）"
# next start 运行时读取：.next、public、node_modules（服务器自装）、package.json、
# next.config.ts（headers() 在服务启动时求值）、.version（next.config 读它注入版本号）。
# package-lock.json 一并带上：服务器端据此判断是否需要重装依赖。
tar --exclude='.next/cache' -czf "$TARBALL" .next public package.json package-lock.json next.config.ts .version
ls -lh "$TARBALL"

step "6/8" "上传到服务器（含最新 update.sh）"
scp -o ConnectTimeout=25 "$TARBALL" "$REMOTE_HOST:$REMOTE_TAR"
# update.sh 随仓库版本化，每次部署同步到服务器（它本身不在产物包里）
scp -o ConnectTimeout=25 "$PROJECT_DIR/scripts/update.sh" "$REMOTE_HOST:$REMOTE_UPDATE"

step "7/8" "远程更新（清 .next + 解压 + 依赖检查 + pm2 restart + 验证）"
ssh -o ConnectTimeout=25 "$REMOTE_HOST" "bash $REMOTE_UPDATE $REMOTE_TAR"

# 部署校验：线上 BUILD_ID 必须等于本次构建的 BUILD_ID
# （防止上传包缺 .next 等原因导致线上静默跑旧构建）
step "8/8" "BUILD_ID 终验"
LOCAL_BUILD_ID="$(cat "$BUILD_DIR/.next/BUILD_ID")"
REMOTE_APP_DIR="$(dirname "$REMOTE_UPDATE")"
REMOTE_BUILD_ID="$(ssh -o ConnectTimeout=25 "$REMOTE_HOST" "cat '$REMOTE_APP_DIR/.next/BUILD_ID'" 2>/dev/null || echo '')"
if [ "$LOCAL_BUILD_ID" != "$REMOTE_BUILD_ID" ]; then
  echo "❌ 部署校验失败：线上 BUILD_ID($REMOTE_BUILD_ID) ≠ 本地($LOCAL_BUILD_ID)"
  exit 1
fi
echo "✅ BUILD_ID 校验通过：$LOCAL_BUILD_ID"
echo "=== 部署完成，总耗时 $(( $(date +%s) - T0 ))s ==="
