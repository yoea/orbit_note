#!/bin/bash
# Quiet Orbit 启动脚本（standalone 产物的一部分，随包上传）
#
# 为什么需要它，而不是让 pm2 直接跑 `node server.js`：
#   standalone 的 server.js **不会自己加载 .env**（那是 `next start` 的职责）。
#   本项目的服务器配置（DATABASE_URL / SESSION_SECRET / WEBAUTHN_* …）全部来自
#   APP_DIR/.env，且 lib/server/env.ts 在 import 期就解析并校验。若不显式载入，
#   进程会在启动时直接抛错。这里载入后再 exec，把不确定性消掉。
#
# 为什么显式设 HOSTNAME：
#   Next standalone 用 `process.env.HOSTNAME || '0.0.0.0'` 决定监听地址，而 bash 自己
#   就会设一个 HOSTNAME 变量——不显式覆盖就可能绑到主机名解析出的地址上，OpenResty
#   （跑在 Docker 里）就代理不进来。保持与旧 `next start` 一致：绑 0.0.0.0。
set -e
cd "$(dirname "$0")"

set -a
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
set +a

export NODE_ENV=production
export HOSTNAME=0.0.0.0
export PORT="${PORT:-10826}"

exec node server.js
