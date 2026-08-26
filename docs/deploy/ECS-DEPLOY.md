# ECS 生产部署指南

架构：

```
Internet → Nginx(:443, TLS) → Next.js(:3000) → PostgreSQL(:5432)
```

## 1. 服务器准备

- Ubuntu 22.04+ / Debian 12（或你习惯的发行版）
- Node.js LTS（>= 20.9，推荐 22 LTS）：
  - `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`
- PostgreSQL 16+：`sudo apt-get install -y postgresql`
- Nginx：`sudo apt-get install -y nginx`

## 2. PostgreSQL 初始化

```bash
sudo -u postgres psql
CREATE USER quiet_orbit WITH PASSWORD '强随机密码';
CREATE DATABASE quiet_orbit OWNER quiet_orbit;
\q
```

## 3. 部署代码

```bash
sudo mkdir -p /opt/quiet-orbit && sudo chown $USER /opt/quiet-orbit
cd /opt/quiet-orbit
git clone <你的仓库> .
npm ci                     # 完整安装（migrate/build 需要 devDependencies，见第 5 步说明）
```

## 4. 环境变量

创建 `/opt/quiet-orbit/.env`（生产值）：

```
DATABASE_URL=postgres://quiet_orbit:强随机密码@localhost:5432/quiet_orbit
WEBAUTHN_RP_ID=diary.example.com        # 你的正式域名
WEBAUTHN_RP_NAME=我的日记
WEBAUTHN_ORIGIN=https://diary.example.com
SESSION_SECRET=<openssl rand -base64 48>
RECOVERY_KEY_VERSION=1
NODE_ENV=production
```

注意：**不要**在环境变量中放入 Passkey 私钥 / 加密密钥 / Recovery Key（它们从不在服务器生成或保存）。

## 5. Migration 与构建

```bash
cd /opt/quiet-orbit
DATABASE_URL=... npx drizzle-kit migrate   # 或 npm run db:migrate（需 DATABASE_URL）
npm run build
```

> migrate 与 build 需要 devDependencies（drizzle-kit/typescript/tailwind），因此先完整安装；运行阶段可 `npm prune --omit=dev` 精简 node_modules。

## 6. 进程管理（systemd）

`sudo cp docs/deploy/quiet-orbit.service.example /etc/systemd/system/quiet-orbit.service`
编辑文件确认路径/用户后：

```bash
# 若 systemd 服务使用 www-data 用户，需给运行目录写权限：
sudo chown -R www-data:www-data /opt/quiet-orbit/.next /opt/quiet-orbit/.cache
sudo systemctl daemon-reload
sudo systemctl enable --now quiet-orbit
sudo systemctl status quiet-orbit
```

（PM2 替代方案：`npm i -g pm2 && pm2 start "npm run start" --name quiet-orbit && pm2 save && pm2 startup`）

## 7. Nginx 反向代理 + HTTPS

`sudo cp docs/deploy/nginx.conf.example /etc/nginx/sites-available/quiet-orbit`
编辑替换域名后启用：

```bash
sudo ln -s /etc/nginx/sites-available/quiet-orbit /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

HTTPS 证书（certbot）：

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d diary.example.com
```

## 8. 备份

cron 每日备份（备份只含密文）：

```bash
crontab -e
# 每天 3:17 备份
17 3 * * * pg_dump -U quiet_orbit quiet_orbit | gzip > /var/backups/quiet_orbit_$(date +\%F).sql.gz && find /var/backups -name 'quiet_orbit_*.sql.gz' -mtime +14 -delete
```

恢复：

```bash
gunzip -c /var/backups/quiet_orbit_2026-08-26.sql.gz | psql -U quiet_orbit quiet_orbit
```

## 9. 更新流程

```bash
cd /opt/quiet-orbit
git pull
npm ci                     # 完整安装（migrate/build 需要 devDependencies）
DATABASE_URL=... npx drizzle-kit migrate   # 有 schema 变更时
npm run build
npm prune --omit=dev       # 可选：运行阶段精简 devDependencies
sudo systemctl restart quiet-orbit
```

## 10. 安全要点

- 生产 CSP 已由应用注入（proxy.ts）；Nginx 无需重复设置 CSP，但保留其他安全头（见示例）
- 所有流量走 HTTPS（certbot 自动续期）
- 服务器 5432 端口只监听 localhost（PostgreSQL 默认）
- 无第三方 JS / 无统计脚本
- 定期 `sudo apt update && sudo apt upgrade` 与 `npm audit`（注意只修 production 依赖的漏洞）
