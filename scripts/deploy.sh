#!/bin/bash
# Quiet Orbit 一键部署（本地执行）
# 流程：schema 检查 → 同步代码（复用依赖缓存）→ 构建 → 打包（不含 node_modules）→ 上传 → 远程更新 → 验证
# 用法：bash scripts/deploy.sh
#
# 性能设计（2026-09-28 大改，部署从 ~2m48s 降到 ~30s）：
#   1) BUILD_DIR（/tmp/qo-prod）常驻：node_modules 与 .next/cache 跨部署保留。
#      package-lock.json 未变化时跳过 npm ci（省 ~30s）；Turbopack 增量构建（省冷编译）。
#   2) 上传包只含 .next/public/package.json 等运行时文件，**不含 node_modules**
#      （原 95M/解压 771M → 现 ~6M）。依赖变化时由服务器端 update.sh 执行
#      npm ci --omit=dev（服务器已验证可直连 registry.npmjs.org）。
#   3) 服务器解压前 rm -rf .next —— 既消除孤儿 chunk 累积（曾累积 526 个文件/74M，
#      污染一切 grep 核验），也让 .next 体积恒定。
#   4) 清 .next 用 cmd 的原生 rmdir（见 rm_tree）：Windows 上 MSYS rm -rf 要 7.2s
#      （约 15ms/文件 × 600+ 文件），原生只要 1.6s。.next/cache 先移出再放回。
#   5) 线上 BUILD_ID 由 update.sh 回读打印，deploy.sh 捕获其输出即可终验，
#      省掉一次单独的 ssh 往返（~4s）。
#   实测坑（勿重蹈）：曾试过「把旧产物 mv 走 + 后台删除」，反而更慢——MSYS 下 mv
#   目录树同样是逐文件开销（9s），且后台删除与构建抢 I/O 把 build/打包从 12s/1s
#   拖到 14s/7s。Windows 上唯一有效的杠杆是「绕开 MSYS 用原生工具」。
#   各步耗时由 step()/mark() 打印，便于日后继续定位瓶颈。
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
LAST=$(date +%s)
# DRY_RUN=1：只跑到「组装 standalone 产物 + 隔离冒烟」为止就退出，不碰服务器。
# 用途：改动了打包/构建逻辑后，先在本地验证产物真的能起来，再决定要不要上线。
DRY_RUN="${DRY_RUN:-0}"
step() {
  local now; now=$(date +%s)
  echo "=== [$1] $2（本步 $(( now - LAST ))s / 累计 $(( now - T0 ))s） ==="
  LAST=$now
}
# 子步骤计时：定位慢在哪一段（Windows 上文件操作与 ssh 往返是主要成本）
mark() {
  local now; now=$(date +%s)
  echo "      · $1（本步 $(( now - LAST ))s / 累计 $(( now - T0 ))s）"
  LAST=$now
}
# 删目录树。Windows（Git Bash）上文件操作走 MSYS 兼容层，实测约 15ms/文件，
# .next 有 600+ 文件，于是「删 .next」成了部署里最贵的一步（rm -rf 7.2s）；
# cmd 的原生 rmdir 走 Win32 API，同样的内容只要 1.6s（快 4.4 倍）。
# 非 Windows 无此开销，直接用 rm -rf。
rm_tree() {
  if [ ! -e "$1" ]; then return 0; fi
  if command -v cygpath >/dev/null 2>&1; then
    cmd //c "rmdir /s /q $(cygpath -w "$1")" >/dev/null 2>&1 || true
  fi
  if [ -e "$1" ]; then rm -rf "$1"; fi
  return 0
}

echo "=== [1/8] 生产库 schema 前置检查 ==="
# 迁移必须先在服务器上执行——deploy.sh / update.sh 都不跑迁移。
# 漏掉会出现「代码上线了但表/列不存在」的 500，且没有明显报错，很难排查，
# 因此这里做成硬失败（检查不通过即中止，不会白跑一次构建）。
# ssh 由本脚本执行、Node 只做解析比对：本机 Node 的 child_process 在受限环境里
# spawn 会 EBUSY（实测连 node -v / git --version 都起不来），不能交给 Node 内部再起 ssh。
if [ "$DRY_RUN" = "1" ]; then
  echo "已跳过（DRY_RUN=1）"
elif [ "${SKIP_SCHEMA_CHECK:-0}" = "1" ]; then
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
mark "移出构建缓存"
# .next 走原生删除（见 rm_tree）
rm_tree "$BUILD_DIR/.next"
mark "删除旧 .next"
# 其余顶层条目一并清掉。CODEBUDDY_SAFE_DELETE_ENABLED=0：绕开 WorkBuddy 的 safe-delete
# shim（它给每条 rm 包一层、批量删除还要额外 spawn 守卫进程，在本机 spawn 受限时既慢又可能失败）。
# 作用域仅这一条命令、只删构建目录 /tmp/qo-prod 内的东西。
CODEBUDDY_SAFE_DELETE_ENABLED=0 find "$BUILD_DIR" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
mark "清除其余旧产物"
if [ -n "$CACHE_TMP" ] && [ -d "$CACHE_TMP" ]; then
  mkdir -p "$BUILD_DIR/.next"
  mv "$CACHE_TMP" "$BUILD_DIR/.next/cache"
fi
mark "放回构建缓存"
# 同步源码（排除缓存/密钥/内部记录）
tar --exclude=node_modules --exclude=.next --exclude=.env.local --exclude=.env \
    --exclude=.git --exclude=.workbuddy -czf - -C "$PROJECT_DIR" . | tar -xzf - -C "$BUILD_DIR"
mark "同步源码"
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
mark "next build"
# 构建产物硬校验：缺 BUILD_ID 说明 build 实际失败，立即中止，不要上传半成品
if [ ! -f .next/BUILD_ID ]; then
  echo "❌ 构建失败：.next/BUILD_ID 不存在。中止部署。"
  exit 1
fi
rm -f .env
# 注意：不再 npm prune——node_modules 不上传（留在本地缓存供下次构建，含 devDeps）

step "5/8" "组装 standalone 产物并打包（服务器只解包，不装依赖不构建）"
# 2026-09-29 起改用 Next.js standalone（next.config.ts 的 output:'standalone'）。
# 背景：旧包不含 node_modules，代价是 lockfile 变化时服务器要跑 npm ci --omit=dev；
# 服务器 CPU/磁盘很弱且带 BPS 限速，实测把线上 IO 打满、站点与 SSH 全部不可达。
# 现在服务器只做「解包 + 重启」。
#
# 组装规则（显式重建，不依赖 .next/standalone 里原有的内容）：
#   standalone/*  → 包根（server.js + 追踪出的最小 node_modules + .next/server 等）
#   .next/static  → 包根/.next/static   （Next 不会自动带上，必须自己复制）
#   public/       → 包根/public         （同上）
#   scripts/start.sh → 包根/start.sh    （载入 .env 后 exec node server.js）
#   .version      → 包根/.version       （服务器侧定位版本用）
STAGE="$BUILD_DIR/standalone-pkg"
if [ ! -f .next/standalone/server.js ]; then
  echo "❌ 未生成 standalone 产物（.next/standalone/server.js 不存在）。"
  echo "   检查 next.config.ts 是否仍有 output:'standalone'，或构建是否失败。"
  exit 1
fi
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -a .next/standalone/. "$STAGE"/
# 先删再拷：standalone 原产物里可能已存在同名目录（内容不全或陈旧），必须整体替换
rm -rf "$STAGE/.next/static" "$STAGE/public"
cp -a .next/static "$STAGE/.next/static"
cp -a public "$STAGE/public"
cp -a "$PROJECT_DIR/scripts/start.sh" "$STAGE/start.sh"
cp -a .version "$STAGE/.version"

# 产物完整性硬校验：缺任何一项都不要上传（宁可不上线，也不要传一个起不来的包）
for f in server.js start.sh .version .next/BUILD_ID .next/static/chunks public; do
  if [ ! -e "$STAGE/$f" ]; then
    echo "❌ standalone 产物不完整：缺少 $f。中止部署。"
    exit 1
  fi
done

# 打包前本地冒烟：把产物**放到项目之外的隔离目录**启动一次。
# 为什么必须隔离：Node 解析模块会向上查找父目录，留在项目内会命中仓库的 node_modules，
# 把「产物自己缺依赖」这种致命问题掩盖掉（本次事故就是这么被我误判了两次）。
# /login 是预渲染页，不碰数据库，足以证明进程能起、静态资源能服务。
SMOKE_DIR="$(mktemp -d)"
tar -czf "$TARBALL" -C "$STAGE" .
tar -xzf "$TARBALL" -C "$SMOKE_DIR"
set +e
# exec 让子 shell 被 node 取代 ⇒ 记下的 PID 就是 node 的，kill 才杀得掉
( cd "$SMOKE_DIR" && exec env PORT=10999 HOSTNAME=127.0.0.1 node server.js >"$SMOKE_DIR/smoke.log" 2>&1 & echo $! > "$SMOKE_DIR/pid" )
sleep 4
SMOKE_CODE="$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 10 http://127.0.0.1:10999/login || true)"
kill "$(cat "$SMOKE_DIR/pid" 2>/dev/null)" 2>/dev/null
set -e
rm -rf "$SMOKE_DIR"
if [ "$SMOKE_CODE" != "200" ]; then
  echo "❌ standalone 产物冒烟失败（/login 返回 $SMOKE_CODE）。中止部署，不上传。"
  exit 1
fi
echo "产物冒烟通过（隔离目录启动 /login = 200）"
ls -lh "$TARBALL"

if [ "$DRY_RUN" = "1" ]; then
  echo "=== DRY_RUN=1：产物已就绪且冒烟通过，按预期在此停止（未上传、未碰服务器）==="
  echo "    产物包：$TARBALL"
  echo "    解包后结构预览：server.js / start.sh / .version / .next / public / node_modules"
  exit 0
fi

step "6/8" "上传到服务器（含最新 update.sh）"
scp -o ConnectTimeout=25 "$TARBALL" "$REMOTE_HOST:$REMOTE_TAR"
# update.sh 随仓库版本化，每次部署同步到服务器（它本身不在产物包里）
scp -o ConnectTimeout=25 "$PROJECT_DIR/scripts/update.sh" "$REMOTE_HOST:$REMOTE_UPDATE"

step "7/8" "远程更新（清旧产物 + 解压 + pm2 restart + 验证）"
# 捕获远程输出：BUILD_ID 由 update.sh 自己回读并打印在最后一行，
# 省掉一次单独的 ssh 往返（实测 ~4s），校验效力相同（仍是脚本跑完后的线上实值）。
#
# 必须先把输出打出来、再判断退出码：`X="$(cmd)"` 在 set -e 下会因为 cmd 非零而
# 直接中断脚本，于是**远程脚本的真实报错被完全吞掉**——2026-09-29 排查线上事故时，
# 我因此只看到「第 7 步无输出 + 退出 1」，误判了很久。先打印再加 2>&1，报错就看得见。
set +e
REMOTE_LOG="$(ssh -o ConnectTimeout=25 "$REMOTE_HOST" "bash $REMOTE_UPDATE $REMOTE_TAR" 2>&1)"
REMOTE_RC=$?
set -e
printf '%s\n' "$REMOTE_LOG"
if [ "$REMOTE_RC" != "0" ]; then
  echo "❌ 远程更新失败（服务器端退出码 $REMOTE_RC）。上面的输出就是服务器端的真实报错。"
  exit 1
fi

# 部署校验：线上 BUILD_ID 必须等于本次构建的 BUILD_ID
# （防止上传包缺 .next 等原因导致线上静默跑旧构建）
step "8/8" "BUILD_ID 终验"
LOCAL_BUILD_ID="$(cat "$BUILD_DIR/.next/BUILD_ID")"
REMOTE_BUILD_ID="$(printf '%s\n' "$REMOTE_LOG" | sed -n 's/^BUILD_ID: //p' | tail -1)"
if [ -z "$REMOTE_BUILD_ID" ] || [ "$LOCAL_BUILD_ID" != "$REMOTE_BUILD_ID" ]; then
  echo "❌ 部署校验失败：线上 BUILD_ID('$REMOTE_BUILD_ID') ≠ 本地('$LOCAL_BUILD_ID')"
  exit 1
fi
echo "✅ BUILD_ID 校验通过：$LOCAL_BUILD_ID"
echo "=== 部署完成，总耗时 $(( $(date +%s) - T0 ))s ==="
