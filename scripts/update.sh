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
# ★ 产物绝不能覆盖生产 .env（2026-09-30 真实事故的根因侧）
# Next 的 standalone 输出会带上构建机的 .env（即本地开发配置），解压即覆盖生产 .env
# ⇒ 库密码与 WebAuthn 域名双双变成开发值，而进程照常起、/login 照常 200，极难察觉。
# 三重防护：① 解压时显式排除 .env*；② 解压前后比对 .env 校验和，变了立刻中止；
# ③ 产物里若含 .env 就打印出来（定位是哪一侧漏了清理）。
# 对应的构建侧清理见 deploy.sh [5/8]。
# `|| true` 是必需的：.env 不存在时 md5sum 返回 1，而本脚本开着 `set -e`
# ⇒ `VAR="$(md5sum ... | cut ...)"` 会因赋值失败直接中止（且不打印报错）。
ENV_BEFORE="$(md5sum .env 2>/dev/null | cut -d' ' -f1 || true)"
if tar tzf "$TARBALL" 2>/dev/null | grep -qE '^\./\.env($|\.)'; then
  echo "⚠️  产物里含 .env（构建侧未清理）：$(tar tzf "$TARBALL" 2>/dev/null | grep -E '^\./\.env($|\.)' | tr '\n' ' ')"
fi
tar xzf "$TARBALL" --exclude='./.env' --exclude='./.env.*'
ENV_AFTER="$(md5sum .env 2>/dev/null | cut -d' ' -f1 || true)"
if { [ -n "$ENV_BEFORE" ] && [ "$ENV_BEFORE" != "$ENV_AFTER" ]; } || \
   { [ -z "$ENV_BEFORE" ] && [ -n "$ENV_AFTER" ]; }; then
  echo "❌ 生产 .env 被产物改动了（部署中止）。请检查 deploy.sh [5/8] 的产物清理。"
  echo "   改动前 md5=${ENV_BEFORE:-<不存在>} 改动后 md5=${ENV_AFTER:-<不存在>}"
  exit 1
fi
echo ".env 未被产物改动（md5 ${ENV_AFTER:-<无>}）"
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
# ---- WebAuthn 运行期校验（2026-09-29 真实事故后加）----
# （用 >>> / <<< 标记包起来，方便单独抽出来做正/反例验证）
# 静态检查挡不住「配置是开发值、服务却照常起」这一类：必须真的问一次运行中的进程，
# 再把它的答案和 .env 对齐。
# 事故形态：服务器 .env 残留 WEBAUTHN_RP_ID=localhost ⇒ 进程健康、/login 200、
# 库也连得上，但用户浏览器直接拒绝所有通行密钥
# （The RP ID "localhost" is invalid for this domain）——**认证全废却零征兆**。
# >>> webauthn-check
ENV_FILE="$APP_DIR/.env"
RP_EXPECT="$(grep -m1 '^WEBAUTHN_RP_ID=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r')"
ORIGIN_EXPECT="$(grep -m1 '^WEBAUTHN_ORIGIN=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r')"
case "$RP_EXPECT" in
  "" | localhost | 127.0.0.1)
    echo "❌ .env 的 WEBAUTHN_RP_ID('$RP_EXPECT') 非法（空或开发值）——浏览器会拒绝所有通行密钥"
    exit 1
    ;;
esac
case "$ORIGIN_EXPECT" in
  https://*) ;;
  *)
    echo "❌ .env 的 WEBAUTHN_ORIGIN('$ORIGIN_EXPECT') 不是 https——浏览器会判定 origin 不匹配"
    exit 1
    ;;
esac
case "$ORIGIN_EXPECT" in
  *localhost* | *127.0.0.1*)
    echo "❌ .env 的 WEBAUTHN_ORIGIN('$ORIGIN_EXPECT') 指向本机——这是开发值，生产认证会全部失败"
    exit 1
    ;;
esac
RP_ACTUAL="$(curl -s --max-time 10 http://localhost:10826/api/auth/login/options | /usr/bin/node -e '
  let s = ""
  process.stdin.on("data", (d) => { s += d })
  process.stdin.on("end", () => {
    try { process.stdout.write(String(JSON.parse(s).options.rpId)) } catch { process.stdout.write("") }
  })' || true)"
if [ "$RP_ACTUAL" != "$RP_EXPECT" ]; then
  echo "❌ 运行期 rpId('$RP_ACTUAL') ≠ .env 的 WEBAUTHN_RP_ID('$RP_EXPECT')"
  echo "   说明进程环境与 .env 不一致——检查 start.sh 是否真的载入了 .env（且是强制覆盖语义）"
  exit 1
fi
echo "webauthn: rpId=$RP_ACTUAL  origin=$ORIGIN_EXPECT"
# <<< webauthn-check
"$PM2_BIN" status "$APP_NAME" | grep "$APP_NAME" || true
echo "=== 更新完成 ==="
# 回读线上 BUILD_ID 供 deploy.sh 终验（格式固定，deploy.sh 用 sed 提取）。
# 放在最后一行：deploy.sh 捕获本脚本输出后无需再开一次 ssh 往返。
echo "BUILD_ID: $(cat "$APP_DIR/.next/BUILD_ID")"
