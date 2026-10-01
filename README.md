# Orbit

**端到端加密的私人日记 PWA——数据只属于你，服务器永远看不到你的文字。**

Orbit 是一款单用户私人日记应用：正文在浏览器本地加密后上传，服务器数据库只存密文；登录无密码，使用通行密钥（WebAuthn），支持指纹、Face ID、Windows Hello 等。可安装到手机主屏幕 / 桌面，像原生 App 一样使用。

## 功能特性

- **端到端加密**：AES-256-GCM 客户端加密（每篇独立 IV），服务器只有密文与元数据
- **通行密钥登录**：WebAuthn + PRF 密钥派生，无密码；支持指纹 / Face ID / Windows Hello 等
- **恢复密钥兜底**：256-bit 熵，只显示一次；通行密钥丢失时用它找回数据
- **多设备**：同一账号可注册多把通行密钥，逐设备管理（禁用 / 启用 / 踢下线）
- **自动草稿**：IndexedDB 本地优先 + 服务器同步 + 冲突处理，关闭页面不丢输入
- **位置记录**：可选保存坐标（可关闭），自动反查**结构化地名（省 / 市 / 区）**并展示；
  漏记的可在编辑态补加（读取当前定位或手填坐标）；只有单一地名串的老条目，
  在详情页打开时会自动重新反查并升级成三级结构
- **实时天气**：保存时自动记录天气（和风天气，JWT 服务器代理，可关闭）
- **主题外观**：跟随系统 / 浅色 / 深色三档；首帧即应用，不闪系统色
- **习惯养成**：连续写作天数（Streak）、每日写作提示（365 条，随机洗牌逐条出现，点击切换）、
  「去年的今天」回忆卡片
- **保存反馈**：清脆的保存音效（Web Audio 合成，任天堂风格，可关闭）+ 小型通知弹窗
- **全部日记**：写作频率热力图（16 级色阶，可关闭）、按日分组时间线（标题 + 预览 + 字数）、
  字数统计（篇数/天数/总字数）
- **个人信息**：名字（DEK 加密存服务器，可随时修改）+ 生成式头像 +
  篇数 / 天数 / 字数一览
- **收藏日记**：详情页底部一键收藏（数据库字段），仅在日记列表与详情页以暖色五角星标示；
  状态只由星形本身表达（实心 / 描边两态，不带文字）
- **打开次数**：详情页记录这一篇被打开过几次；由服务器**原子自增**并**入库**
  （跨设备一致、随备份往返），与收藏并排显示在底部操作栏最前；打开行为不计入「编辑」，
  显示与否可在偏好里关掉（关掉只隐藏展示，仍照常统计）
- **搜索与筛选**：右上角放大镜 → 关键词检索正文与地点，外加**三类筛选**（各条件**取交集**）：
  - **时间**：全部时间 / 近 7 天 / 近 30 天 / **具体月份**（按月精确跳转，选项来自实际写过的月份）
  - **收藏**：全部 / 仅收藏
  - **地点**：全部地点 / 只看有位置 / 具体地点（地点清单带篇数，来自实际数据，不用手打）
  正文是端到端加密的，服务端无法参与检索——密文一次性拉到本地、解密后匹配；
  **明文只存在内存中，关闭弹窗即释放**（不写 IndexedDB / localStorage）
- **导出与导入**：验证身份（通行密钥或恢复密钥）后，可在本地解密导出全部日记为
  **Day One 兼容 JSON**（`.zip` 压缩包，主推；Day One / Journey 可直接导入）、
  **JSON**（单文件）或 **CSV**（给 Excel，不能导回本应用）。文件含数据库里的**全部字段**
  ——正文、创建/修改时间、坐标、结构化地名（省/市/区）、定位精度、天气、时区、字数、收藏状态、
  打开次数；重新导入自家导出即**完整恢复**
- **删除保护**：删除所有数据需输入文字 + 生物识别双重确认
- **底部导航**：写 / 日记 / 设置 三个平级入口常驻底部（iOS 风格 tab bar），
  取代原先的全局页脚；详情与子页面保留返回箭头
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

### 本地构建产物部署（本项目使用）

**不依赖任何 agent / IDE**——`scripts/deploy.sh` 就是一个普通 bash 脚本，直接在终端跑。

```bash
bash scripts/deploy.sh
```

**前置条件（缺一个都会失败）**

1. **配置 `.env.local`**（项目根，已在 `.gitignore` 内）：
   - `REMOTE_HOST` = `~/.ssh/config` 里的主机别名
   - `REMOTE_UPDATE` = 服务器端 `update.sh` 的绝对路径
   - 它同时被 `cp` 成构建期的 `.env`，所以还要含 `DATABASE_URL`、`NEXT_PUBLIC_*` 等（见 `.env.example`）。
   - ⚠️ 该文件含真实密钥，**绝不入库**。
2. **SSH 可用**：`~/.ssh/config` 里该别名指向正确，且 `IdentityFile` 私钥**确实可读**（若私钥放在 OneDrive 等同步目录里且只是「仅在线」占位，ssh 会失败且不会告诉你原因）。
3. **PATH 上有** `node` / `npm` / `ssh` / `scp` / `curl` / `tar` / `sha256sum`，以及 `git`（版本号取自 `git describe`，仓库需带 tag）。
4. **运行环境**：Windows 用 **Git Bash**（MSYS）；Linux / macOS 用任意 bash 均可。非 MSYS 环境下脚本会自动退化为普通 `rm -rf`，只是 Windows 上慢几秒。

**流程**：生产库 schema 前置检查 → 同步代码到常驻构建目录（复用 `node_modules` 与构建缓存）→ 注入版本号 → 本地构建 → 组装 **Next.js standalone** 产物（`server.js` + `start.sh` + 追踪出的最小 `node_modules` + `.next` + `public`）并**在项目外的隔离目录启动冒烟** → scp 上传（约 8MB）→ 服务器 `rm -rf .next node_modules public` + 解压 + `pm2 restart` → HTTP 轮询验证 → BUILD_ID 终验。
本项目实测约 **85–100 秒**（脚本逐步打印耗时，上传带宽是主要变量）。

> **服务器只做「解包 + 重启」——不装依赖、不构建、不需要访问 npm registry。** 这是 2026-09-29 事故后的硬约束：旧流程会在 lockfile 变化时于服务器跑 `npm ci --omit=dev`，而这台机器 CPU/磁盘很弱且带宽受限，实测把线上 IO 打满、站点与 SSH 全部不可达。**不要改回去。**

**只跑本地半程**（改过打包/构建逻辑后先验证产物能起来，不碰服务器）：

```bash
DRY_RUN=1 bash scripts/deploy.sh
```

> ⚠️ **迁移必须先在服务器执行**。`deploy.sh` / `update.sh` 都不跑迁移，所以 deploy 的第 1 步会对照 `drizzle/*.sql` 检查生产库 schema（表与列），**发现落后即中止**，不会白跑一次构建。
> 紧急情况下可用 `SKIP_SCHEMA_CHECK=1 bash scripts/deploy.sh` 跳过——但只在明确知道为什么要跳过时用。

**服务器端只需**：Node.js 20+、PM2、PostgreSQL、解压工具。

### ~~服务器直接构建~~（已废弃，勿用）

> 早期文档写过的 `npm ci && npm run build && pm2 start npm -- start` 流程**已彻底废弃**——它在服务器上装依赖并构建，正是上面那起「IO 打满、SSH 不可达、pm2 崩溃循环」事故的直接成因。生产配置改走**本地构建 → 上传 standalone 产物**。

### 数据库迁移

迁移**不随部署自动执行**——必须先在服务器上按序手工执行新增的 `drizzle/000X_*.sql`（`deploy.sh` 第 1 步会对照 `drizzle/*.sql` 校验生产库 schema 是否跟上，落后即中止）。

本项目生产库跑在 **Docker 容器 `postgre-db`** 里、**宿主机没有 `psql`**，所以要在服务器上用容器内的客户端执行：

```bash
# 在服务器上执行（<pw> = 容器 POSTGRES_PASSWORD）
docker exec -i -e PGPASSWORD=<pw> postgre-db \
  psql -U quiet_orbit -d quiet_orbit -f - < drizzle/0007_flippant_beast.sql
```

迁移前先备份（`docker exec -e PGPASSWORD=<pw> postgre-db pg_dump -U quiet_orbit quiet_orbit > backup.sql`），改完**直接查库核对**（`information_schema.columns`）。

> ⚠️ **HTTPS 提醒**：生产环境 WebAuthn（通行密钥）要求 HTTPS（localhost 除外）。证书申请、反向代理等属于运维范畴，请自行配置（如 Caddy / Nginx / 云厂商 LB）。

### 恢复密钥提示

初始化时生成的恢复密钥**只显示一次**——务必保存到密码管理器。通行密钥全部丢失时，登录页可用恢复密钥找回数据。

## 使用方法

> 登录后进入的三块内容（写 / 日记 / 设置）通过**底部导航栏**切换，当前所在 tab 高亮；
> 「写」与「设置」是 tab 目的地，页头不再放返回箭头。详情页（`/entry/*`）与
> 子页面（`/settings/export`、`/settings/passkey` 等）保留页头返回箭头。
> 偏好设置自 v1.15.2 起是弹窗而非独立路由（交互同「关于」），故无返回箭头。

1. **首次访问** → 自动进入初始化：创建通行密钥（生物识别）→ 保存恢复密钥 → 完成
2. **写日记**（「写」）→ 输入即自动保存草稿（关闭页面不丢）→ 点「保存」落库（可记录位置）
3. **全部日记**（「日记」）→ 写作频率热力图（最近半年）+ 按日分组列表（首行为标题）；点条目进详情
   （底部操作栏 4 个图标：打开次数 · 收藏 · 编辑 · 删除；地点名在上方，点它复制坐标，
   「编辑于」钉在操作栏分割线正上方）
   右上角 🔍 打开搜索：关键词（正文与地点）+ 三类筛选（时间：全部/近 7 天/近 30 天/具体月份 ·
   收藏：全部/仅收藏 · 地点：全部地点/只看有位置/具体地点）
   （旧路由 `/history` 仍可用，会重定向到 `/diary`）
4. **设置** →
   - 顶部个人信息卡片：生成式头像 + 名字（点开可改，加密后多端同步）+「N 篇 · N 天 · N 字」
     （注册时间已由服务端记录，但当前不在界面上展示）
   - 通行密钥：查看各设备、禁用/启用、添加新设备（右上角 ＋）
   - 重新生成恢复密钥（弹窗完成，旧密钥立即失效）
   - 通用：「偏好设置」入口（主题外观、保存/显示类开关、音效、离线缓存）+ 「关于 Orbit」
   - 数据：导出与导入（验证身份后下载 Day One 兼容 JSON 压缩包 / JSON / CSV，
     含全部字段：正文、时间、坐标、结构化地名（省/市/区）、天气、时区、字数、收藏、打开次数）
   - 退出登录 / 删除所有数据（需输入「永久删除」+ 生物识别）
5. **偏好设置**（设置页内弹窗）→ **主题外观**（跟随系统 / 浅色 / 深色）· 保存时记录位置 ·
   保存时记录天气 · 自动补全地点名 · 显示连续写作天数 · 显示每日提示（+ 出现时机：总是 / 仅空白时）·
   显示去年的今天 · 显示打开次数 · 显示写作热力图 · 保存音效 · 离线缓存
   > 多数偏好登录后会从服务器拉取（多端同步）；**主题外观、离线缓存、导出格式记忆**属设备本地，
   > 刻意不同步（跨端同步会互相覆盖出错误状态）。
   > 导出页会**记住上次选过的格式**，下次进来自动选中（默认首次为 JSON 压缩包）。

## 项目结构

```
app/            Next.js 路由与页面（api/ 为服务端接口）
  (app)/        登录后区：共享布局（解锁守卫 + 底部 TabBar），组内页面不含守卫
components/     React 组件（视图、弹窗、TabBar）
lib/client/     客户端逻辑（加密、会话、WebAuthn、草稿同步、导航归属）
lib/server/     服务端逻辑（认证、会话、校验、安全头）
drizzle/        SQL 迁移文件
scripts/        一键部署脚本
docs/           设计文档、安全审计
```

## 许可证

[MIT](./LICENSE)
