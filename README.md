# Orbit

**端到端加密的私人日记 PWA——数据只属于你，服务器永远看不到你的文字。**

Orbit 是一款单用户私人日记应用：正文在浏览器本地加密后上传，服务器数据库只存密文；登录无密码，使用通行密钥（WebAuthn），支持指纹、Face ID、Windows Hello 等。可安装到手机主屏幕 / 桌面，像原生 App 一样使用。

## 功能特性

- **端到端加密**：AES-256-GCM 客户端加密（每篇独立 IV），服务器只有密文与元数据
- **通行密钥登录**：WebAuthn + PRF 密钥派生，无密码；支持指纹 / Face ID / Windows Hello 等
- **恢复密钥兜底**：256-bit 熵，只显示一次；通行密钥丢失时用它找回数据
- **多设备**：同一账号可注册多把通行密钥，逐设备管理（禁用 / 启用 / 踢下线）
- **自动草稿**：IndexedDB 本地优先 + 服务器同步 + 冲突处理，关闭页面不丢输入
- **位置记录**：可选保存坐标（可关闭），自动反查地点名并展示；漏记的可在编辑态补加（读取当前定位或手填坐标）
- **实时天气**：保存时自动记录天气（和风天气，JWT 服务器代理，可关闭）
- **习惯养成**：连续写作天数（Streak）、每日写作提示（365 条，随机洗牌逐条出现，点击切换）、
  「去年的今天」回忆卡片
- **保存反馈**：清脆的保存音效（Web Audio 合成，任天堂风格）+ 小型通知弹窗
- **全部日记**：写作频率热力图（16 级色阶）、按日分组时间线（标题 + 预览 + 字数）、
  字数统计（篇数/天数/总字数）
- **个人信息**：名字（DEK 加密存服务器，可随时修改）+ 生成式头像 +
  始于日期 / 篇数 / 天数 / 字数一览
- **导出**：验证身份（通行密钥或恢复密钥）后，解密导出全部日记为 CSV
- **删除保护**：删除所有数据需输入文字 + 生物识别双重确认
- **PWA**：可安装到主屏幕，独立窗口运行

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js 16（App Router）/ React 19 / TypeScript strict / Tailwind CSS 4 |
| 后端 | Next.js API Routes / Drizzle ORM / postgres.js |
| 数据库 | PostgreSQL |
| 认证 | WebAuthn（@simplewebauthn）+ PRF 扩展 |
| 部署 | PM2（HTTPS/反向代理由运维自行配置） |

## 安全设计

### E2EE 边界（重要）

**E2EE 能防止数据库泄露，但无法完全抵御已经被攻陷的客户端/前端代码。** 如果攻击者控制了生产服务器并能够修改前端 JavaScript，理论上可以诱导用户把明文传给攻击者。本项目通过以下方式降低该风险：

- 生产环境 CSP（`script-src 'self' 'unsafe-inline'`——Next.js RSC 内联脚本所需，无 nonce 方案）
- HTTPS 全站
- 零第三方 JS / 零统计脚本 / 零第三方 CDN（唯一外部请求：客户端直调 BigDataCloud 反查地点名）
- 定期更新依赖

### 密钥层级

```
DEK ── 256-bit CSPRNG 随机，首次初始化生成，仅存于浏览器内存（会话级 sessionStorage 持久化）
│
├── [wrapper: passkey_prf]
│     Passkey PRF 输出(32B)
│       → HKDF-SHA-256(salt=S, info="passkey-kek") → Passkey KEK
│       → AES-256-GCM → encrypted_dek（存服务器）
│
└── [wrapper: recovery]
      Recovery Key（256-bit 熵，显示一次）
        → HKDF-SHA-256(salt=salt_r, info="recovery-kek") → Recovery KEK
        → AES-256-GCM → encrypted_dek（存服务器）
```

- **DEK**：数据加密密钥，只在客户端内存存在，服务器永远拿不到
- **S 不变量**：所有通行密钥共享同一个 PRF eval 输入 S（首个 wrapper 的 salt），但 PRF 输出按凭证隔离——每把钥匙一个 wrapper
- **恢复密钥**：服务器只存 SHA-256 哈希，无法离线爆破

### 会话安全

- 会话 JWT 绑定登录凭证：禁用某设备 → 该设备所有已登录会话立即失效（踢下线）
- CSRF 纵深防御（SameSite=Lax + Origin 校验）
- 登录/注册/写日记等接口均限流

### 第三方服务与数据流向

| 服务 | 用途 | 数据流向 | 调用方 |
|---|---|---|---|
| [BigDataCloud](https://www.bigdatacloud.com) | 经纬度 → 地点名反查 | **坐标先模糊到约 1km 粒度（保留 2 位小数）再发送**（客户端直调，CORS 开放） | 浏览器 |
| [和风天气 QWeather](https://www.qweather.com) | 实时天气（保存时记录） | 坐标发送给该服务（服务器代理，JWT 认证） | 服务器 |
| 浏览器定位（W3C Geolocation） | 保存时获取坐标 | 浏览器原生能力，不经过任何第三方服务器 | 浏览器 |

> 除此之外无任何第三方 JS / CDN / 统计脚本。正文与密钥永不离开设备或服务器加密存储。

## 快速开始（开发）

### 环境要求

- Node.js 20+
- PostgreSQL 14+

### 步骤

```bash
# 1. 克隆并安装依赖
git clone <repo-url>
cd orbit
npm install

# 2. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local 填写真实值（见下）

# 3. 初始化数据库：按序号依次执行 drizzle/ 下全部迁移文件（新部署从 0000 到最新）
for f in drizzle/000*.sql; do
  echo "==> $f"
  psql "$DATABASE_URL" -f "$f"
done

# 4. 启动开发服务器
npm run dev
# 打开 http://localhost:3000 → 首次访问进入初始化流程
```

### 环境变量（`.env.example`）

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `WEBAUTHN_RP_ID` | WebAuthn 依赖方 ID——**必须与访问域名一致**（生产如 `diary.example.com`） |
| `WEBAUTHN_RP_NAME` | 显示名称（如 Orbit） |
| `WEBAUTHN_ORIGIN` | 站点完整 URL（生产如 `https://diary.example.com`） |
| `SESSION_SECRET` | 会话签名密钥，至少 32 字符（`openssl rand -base64 48`） |
| `RECOVERY_KEY_VERSION` | 加密方案版本（默认 1） |
| `QWEATHER_KID` / `QWEATHER_SUB` | 和风天气 JWT 凭据 ID / 项目 ID（可选，未配置则天气功能停用） |
| `QWEATHER_PRIVATE_KEY` | 和风天气 Ed25519 私钥（只存服务器，绝不下发前端） |
| `QWEATHER_HOST` | 和风控制台分配的专属 API Host（如 `xxx.re.qweatherapi.com`） |

> ⚠️ **WebAuthn 要求 HTTPS**（localhost 除外）。`WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGIN` 必须与浏览器地址栏完全一致，否则通行密钥创建/登录会失败。

## 部署（生产）

### 方式一：本地构建产物部署（推荐，本项目使用）

服务器无需安装构建工具链，避免构建时磁盘/内存打满。

```bash
# 本地执行（服务器信息通过环境变量提供，不硬编码在脚本中）
export REMOTE_HOST=myserver            # ~/.ssh/config 中的主机别名
export REMOTE_UPDATE=/path/to/update.sh # 服务器端 update.sh 绝对路径
bash scripts/deploy.sh
```

流程：同步代码 → 注入版本号（git describe + 构建时间戳）→ 本地 `npm ci && npm run build` → 打包（生产 node_modules + .next）→ scp 上传 → 服务器解压 + `pm2 restart` → HTTP 验证。

**服务器端只需**：Node.js 20+、PM2、PostgreSQL、解压工具。

### 方式二：服务器直接构建

```bash
# 服务器
npm ci
cp .env.local .env   # 生产环境变量
npm run build
npm prune --omit=dev
pm2 start npm --name orbit -- start
pm2 save && pm2 startup   # 开机自启
```

### 数据库迁移

应用全部迁移文件（按序号）后，新版本只需执行新增的 `drizzle/000X_*.sql`：

```bash
psql "$DATABASE_URL" -f drizzle/0007_flippant_beast.sql
```

> ⚠️ **HTTPS 提醒**：生产环境 WebAuthn（通行密钥）要求 HTTPS（localhost 除外）。证书申请、反向代理等属于运维范畴，请自行配置（如 Caddy / Nginx / 云厂商 LB）。

### 恢复密钥提示

初始化时生成的恢复密钥**只显示一次**——务必保存到密码管理器。通行密钥全部丢失时，登录页可用恢复密钥找回数据。

## 使用方法

1. **首次访问** → 自动进入初始化：创建通行密钥（生物识别）→ 保存恢复密钥 → 完成
2. **写日记** → 输入即自动保存草稿（关闭页面不丢）→ 点「保存」落库（可记录位置）
3. **全部日记** → 写作频率热力图（最近半年）+ 按日分组列表（首行为标题）；点条目进详情（可编辑/删除/复制坐标/查看地点名）
   （旧路由 `/history` 仍可用，会重定向到 `/diary`）
4. **设置** →
   - 顶部个人信息卡片：生成式头像 + 名字（可改，加密后多端同步）+「始于 <日期> · N 篇 · N 天 · N 字」
     （注册时间优先用服务端记录；本功能上线前注册的老用户回退显示第一篇日记的日期）
   - 通行密钥：查看各设备、禁用/启用、添加新设备（右上角 ＋）
   - 重新生成恢复密钥（弹窗完成，旧密钥立即失效）
   - 通用：「偏好设置」入口 + 「关于 Orbit」
   - 数据：导出笔记（验证身份后下载 CSV，含全部字段：正文、坐标、地点名、天气、时区等）
   - 退出登录 / 删除所有数据（需输入「永久删除」+ 生物识别）
5. **偏好设置**（`/settings/prefs`，多端同步）→ 保存时记录位置 / 保存时记录天气 / 自动补全地点名 / 显示连续写作天数 / 显示每日提示 / 显示去年的今天

## 项目结构

```
app/            Next.js 路由与页面（api/ 为服务端接口）
components/     React 组件（视图、弹窗）
lib/client/     客户端逻辑（加密、会话、WebAuthn、草稿同步）
lib/server/     服务端逻辑（认证、会话、校验、安全头）
drizzle/        SQL 迁移文件
scripts/        一键部署脚本
docs/           设计文档、安全审计
```

## 许可证

[MIT](./LICENSE)
