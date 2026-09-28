#!/bin/sh
# 在服务器上执行：输出生产库 public schema 的全部 table.column。
# 由 scripts/check-schema.mjs 通过 `ssh HOST sh -s` 送入 stdin 执行。
#
# 生产库跑在 Docker 容器 postgre-db 里（宿主机没有 psql），连接串在应用目录的 .env。
# 用法：APP_DIR=/path/to/app sh schema-dump.sh
set -e

APP_DIR="${APP_DIR:-/home/ewing/craft/quiet-orbit}"
cd "$APP_DIR"

DBURL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)
if [ -z "$DBURL" ]; then
  echo "无法从 $APP_DIR/.env 读取 DATABASE_URL" >&2
  exit 2
fi

rest=${DBURL#postgres://}
creds=${rest%%@*}
hostpart=${rest#*@}
DBUSER=${creds%%:*}
DBPASS=${creds#*:}
DBNAME=${hostpart#*/}

docker exec -e PGPASSWORD="$DBPASS" postgre-db \
  psql -U "$DBUSER" -d "$DBNAME" -tAc \
  "select table_name || '.' || column_name from information_schema.columns where table_schema = 'public'"
