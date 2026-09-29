#!/bin/bash
# Quiet Orbit 启动脚本（standalone 产物的一部分，随包上传）
#
# 为什么需要它，而不是让 pm2 直接跑 `node server.js`：
#   standalone 的 server.js **不会自己加载 .env**（那是 `next start` 的职责）。
#   本项目的服务器配置（DATABASE_URL / SESSION_SECRET / WEBAUTHN_* …）全部来自
#   APP_DIR/.env，且 lib/server/env.ts 在 import 期就解析并校验。若不显式载入，
#   进程会在启动时直接抛错。这里载入后再 exec，把不确定性消掉。
#
# ⚠️ 载入是**强制覆盖**（set -a + source），刻意不用 dotenv 的「已存在则不覆盖」语义。
#   `.env` 是生产配置的**唯一真源**，必须可见、可审计、可 diff。
#   2026-09-29 真实事故：服务器 .env 里残留开发值 WEBAUTHN_RP_ID=localhost，
#   而真值只存在于 pm2 启动时捕获的那份环境里（既不可见、也没人记得）。
#   旧入口是 `next start`（dotenv 语义）⇒ .env 不覆盖进程已有值 ⇒ 侥幸正常；
#   换成 standalone + 本脚本后变成强制覆盖 ⇒ localhost 生效 ⇒ 浏览器直接拒绝所有
#   通行密钥（`The RP ID "localhost" is invalid for this domain`）——但进程活着、
#   页面 /login 照样 200，**极难察觉**。
#   因此：不要把这里改成「不覆盖」——那只会把真值重新藏回 pm2 的环境里。
#   正确做法是把生产值写进 APP_DIR/.env；deploy.sh（前置）与 update.sh（运行期）
#   都有校验会拦住这类错。
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
