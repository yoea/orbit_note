#!/bin/bash
# Quiet Orbit 服务器端更新脚本（由 deploy.sh 上传并调用；本文件在仓库内版本化）
# 用法：bash update.sh [tar 包路径]
# 默认 /tmp/quiet-orbit-prod.tar.gz（本地打包上传后）
#
# 2026-09-28 起：
#   - 产物包不含 node_modules：依赖变化时（package-lock.json 的 sha256 与
#     node_modules/.qo-deps-hash 不一致）才在服务器执行 npm ci --omit=dev。
#   - 解压前 rm -rf .next：旧流程「解压覆盖」会让陈旧 chunk 永久累积
#     （实测 526 个 chunk / .next 74M，本次构建只产出 71 个），既占磁盘又
#     污染「grep 产物判断新代码是否上线」的核验。
#   - 验证从盲等 sleep 6 改为轮询：服务就绪即通过（快），20 秒未就绪即失败（稳）。
set -e

APP_DIR=/home/ewing/craft/quiet-orbit
TARBALL="${1:-/tmp/quiet-orbit-prod.tar.gz}"
PM2_BIN=/usr/bin/pm2
DEPS_HASH_FILE="$APP_DIR/node_modules/.qo-deps-hash"

if [ ! -f "$TARBALL" ]; then
  echo "错误：找不到 tar 包 $TARBALL"
  echo "用法：bash $APP_DIR/update.sh [tar包路径]"
  exit 1
fi

echo "=== [1/4] 解压产物（先清旧 .next，杜绝孤儿文件） ==="
cd "$APP_DIR"
rm -rf .next
tar xzf "$TARBALL"
echo "解压完成（.next 大小 $(du -sh .next | cut -f1)，chunk $(ls .next/static/chunks/*.js 2>/dev/null | wc -l) 个）"

echo "=== [2/4] 依赖检查（lockfile 变化才重装） ==="
LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [ ! -d node_modules ] || [ "$(cat "$DEPS_HASH_FILE" 2>/dev/null || true)" != "$LOCK_HASH" ]; then
  echo "依赖变化（或首次），安装生产依赖…"
  # --ignore-scripts：postinstall 均为 dev/平台相关（esbuild/fsevents 等），生产不需要
  npm ci --omit=dev --no-audit --no-fund --ignore-scripts
  # npm ci 会先删掉整个 node_modules，哈希必须在装完后写入
  echo "$LOCK_HASH" > "$DEPS_HASH_FILE"
  echo "生产依赖已安装"
else
  echo "依赖未变化，跳过"
fi

echo "=== [3/4] 重启服务 ==="
"$PM2_BIN" restart quiet-orbit --update-env

echo "=== [4/4] 验证（轮询就绪，最长 20s） ==="
code=000
ok=0
for i in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:10826/api/auth/session || true)"
  if [ "$code" = "200" ]; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != "1" ]; then
  echo "❌ 服务未在 20 秒内就绪（session 返回 $code），回查 pm2 logs quiet-orbit"
  "$PM2_BIN" status quiet-orbit | grep quiet-orbit
  exit 1
fi
echo "session: 200（就绪耗时 ${i}s）"
# 静态页顺带核验（预渲染 HTML + 公共资源能正常服务）
login_code="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:10826/login || true)"
if [ "$login_code" != "200" ]; then
  echo "❌ /login 返回 $login_code（静态资源服务异常）"
  exit 1
fi
echo "login: 200"
"$PM2_BIN" status quiet-orbit | grep quiet-orbit
echo "=== 更新完成 ==="
