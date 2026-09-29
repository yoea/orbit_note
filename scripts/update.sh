#!/bin/bash
# Quiet Orbit 服务器端更新脚本（由 deploy.sh 上传并调用；本文件在仓库内版本化）
# 用法：bash update.sh [tar 包路径]
# 默认 /tmp/quiet-orbit-prod.tar.gz（本地打包上传后）
#
# 2026-09-29 起改用 Next.js standalone 产物：
#   - **服务器不再安装依赖、不再构建**，只做「解包 + 重启」。
#     旧流程在 lockfile 变化时会在服务器跑 `npm ci --omit=dev`；这台服务器 CPU 与磁盘
#     很弱且带 BPS 限速，实测直接把线上 IO 打满、站点与 SSH 全部不可达（真实事故）。
#   - 产物包 = standalone 树（server.js + 追踪出的最小 node_modules + .next + public）
#     + start.sh（载入 .env 后 exec node server.js —— standalone **不会**自己读 .env）。
#   - 解压前 `rm -rf .next node_modules`：两者都必须**整体替换**。残留的 .next 会累积孤儿
#     chunk 并污染「grep 产物判断新代码是否上线」的核验；残留的 node_modules 更是致命——
#     事故现场就是它只剩 110 个包、`next: not found` 崩溃循环。
set -e

APP_DIR=/home/ewing/craft/quiet-orbit
TARBALL="${1:-/tmp/quiet-orbit-prod.tar.gz}"
PM2_BIN=/usr/bin/pm2
APP_NAME=quiet-orbit

if [ ! -f "$TARBALL" ]; then
  echo "错误：找不到 tar 包 $TARBALL"
  echo "用法：bash $APP_DIR/update.sh [tar包路径]"
  exit 1
fi

echo "=== [1/4] 解压产物（整体替换 .next / node_modules / public） ==="
cd "$APP_DIR"
# public 也要整体替换：tar 是覆盖式解包，从 public 里删掉过的文件会在服务器上残留下来
rm -rf .next node_modules public
tar xzf "$TARBALL"
chmod +x start.sh 2>/dev/null || true
if [ ! -f server.js ] || [ ! -f .next/BUILD_ID ]; then
  echo "❌ 产物不完整（缺 server.js 或 .next/BUILD_ID），不重启服务，保留旧进程现状"
  exit 1
fi
echo "解压完成（.next $(du -sh .next | cut -f1)，node_modules $(du -sh node_modules | cut -f1)，chunk $(ls .next/static/chunks/*.js 2>/dev/null | wc -l) 个）"

echo "=== [2/4] 确保 pm2 进程指向 standalone 入口 ==="
# 旧进程的 script path 是 /usr/bin/npm（`npm run start`）。standalone 没有 npm 脚本可跑，
# 必须换成 start.sh。只在尚未切换时重建进程，避免每次部署都动 pm2。
#
# 顺带清理重复条目：crontab 里有两条 `pm2 resurrect`（分别从两个项目目录调用），
# 而 pm2 的 dump 是全局的 —— 机器每次重启都会产生一份重复进程，两个进程抢同一端口。
# 这里在切换时按 id 逐个删干净。
NEED_SWITCH=0
"$PM2_BIN" describe "$APP_NAME" 2>/dev/null | grep -q "$APP_DIR/start.sh" || NEED_SWITCH=1

if [ "$NEED_SWITCH" = "1" ]; then
  echo "切换 pm2 入口 → start.sh（并清理重复条目）"
  "$PM2_BIN" jlist 2>/dev/null | /usr/bin/node -e '
    let s = ""
    process.stdin.on("data", (d) => { s += d })
    process.stdin.on("end", () => {
      try {
        JSON.parse(s).filter((p) => p.name === "quiet-orbit").forEach((p) => console.log(p.pm_id))
      } catch { /* jlist 解析失败则退化为按名删除 */ }
    })
  ' | while read -r id; do
    [ -n "$id" ] && "$PM2_BIN" delete "$id" >/dev/null 2>&1 || true
  done
  # 兜底：上面若没拿到 id（jlist 为空/解析失败），按名删除一次
  "$PM2_BIN" delete "$APP_NAME" >/dev/null 2>&1 || true
  "$PM2_BIN" start "$APP_DIR/start.sh" --name "$APP_NAME" --interpreter bash
  "$PM2_BIN" save >/dev/null 2>&1 || true
else
  echo "入口已是 start.sh，跳过"
fi

echo "=== [3/4] 重启服务 ==="
"$PM2_BIN" restart "$APP_NAME" --update-env

echo "=== [4/4] 验证（轮询就绪，最长 20s） ==="
code=000
ok=0
for i in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:10826/api/auth/session || true)"
  if [ "$code" = "200" ]; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != "1" ]; then
  echo "❌ 服务未在 20 秒内就绪（session 返回 $code），回查 pm2 logs $APP_NAME"
  "$PM2_BIN" status "$APP_NAME" | grep "$APP_NAME" || true
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
"$PM2_BIN" status "$APP_NAME" | grep "$APP_NAME" || true
echo "=== 更新完成 ==="
# 回读线上 BUILD_ID 供 deploy.sh 终验（格式固定，deploy.sh 用 sed 提取）。
# 放在最后一行：deploy.sh 捕获本脚本输出后无需再开一次 ssh 往返。
echo "BUILD_ID: $(cat "$APP_DIR/.next/BUILD_ID")"
