# Orbit 项目说明

> 本文档基于对 `app/`、`lib/`、`components/`、`drizzle/`、`docs/` 源码的核对整理，描述项目定位、架构与关键设计。

## 一句话定位

**Orbit 是一个单用户、端到端加密（E2EE）的私人日记 PWA。** 日记正文在浏览器本地用 AES-256-GCM 加密后才上传，服务器数据库只保存密文与元数据；登录不用密码，走通行密钥（WebAuthn + PRF）。可安装到手机主屏 / 桌面，像原生 App 一样使用。

## 核心特性

| 类别 | 能力 |
|---|---|
| 加密 | AES-256-GCM 客户端加密，每篇独立 IV，服务器仅存密文 |
| 登录 | WebAuthn 通行密钥 + PRF 扩展派生密钥，无密码；支持指纹 / Face ID / Windows Hello |
| 兜底 | 256-bit 恢复密钥，仅显示一次，通行密钥全丢时找回数据 |
| 多设备 | 同一账号可注册多把通行密钥，逐设备管理（禁用 / 启用 / 踢下线） |
| 草稿 | IndexedDB 本地优先 + 服务器同步 + 冲突处理，关页面不丢输入 |
| 记录 | 可选保存坐标（自动反查**结构化地名：省 / 市 / 区**）、保存时自动记录实时天气 |
| 收藏 | 星标收藏（数据库布尔列），暖色五角星**只在查看页与日记列表页**展示；查看页底部操作栏仅以星形两态表示，不带文字 |
| 打开次数 | 每篇被打开过几次，**数据库列**（服务器原子自增，不刷新 `updatedAt`）；与收藏并排显示在查看页底部操作栏最前，并随导出 / 导入往返 |
| 习惯 | 连续写作天数（Streak）、每日提示、往年的今天回忆卡、保存音效 |
| 回顾 | 写作频率热力图（**固定在列表页顶部**）、按日分组时间线、篇数/天数/总字数统计；搜索支持关键词 + **三类筛选**（时间 / 收藏 / 地点，时间档只有「全部时间 / 具体日期」两档）且可任意组合 |
| 导航 | 底部 tab bar（写 / 日记 / 设置）+ 组共享布局；详情/子页保留返回箭头 |
| 导出 | 验证身份（通行密钥或恢复密钥）后解密导出全部日记为 Day One 兼容 JSON 或 CSV，并支持导入回本应用（含**全部数据库字段**，含打开次数） |
| 数据主权 | 删除全部数据需输入文字 + 生物识别双重确认 |

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js 16（App Router）/ React 19 / TypeScript strict / Tailwind CSS 4 |
| 后端 | Next.js API Routes / Drizzle ORM / postgres.js |
| 数据库 | PostgreSQL |
| 认证 | `@simplewebauthn`（浏览器 + 服务端）+ PRF 扩展 |
| 校验 | Zod |
| 测试 | Vitest |
| 部署 | PM2（HTTPS / 反向代理由运维自行配置） |

## 架构与 E2EE 边界

```
浏览器（唯一持有明文与密钥的地方）               服务器（只有密文）
┌──────────────────────────────┐            ┌──────────────────────┐
│ 用户输入明文                  │            │  API Routes          │
│        │ encryptText(DEK)     │            │  只透传 ciphertext/iv │
│        ▼                      │  HTTPS     │        │             │
│  { ciphertext, iv }  ─────────┼───────────▶│  Drizzle ORM         │
│                               │            │        ▼             │
│ 解密仅在客户端 decryptText     │            │  PostgreSQL(密文+元数据)│
└──────────────────────────────┘            └──────────────────────┘
        DEK / PRF 输出 / 恢复密钥明文 —— 永不离开浏览器
```

**关键约束（必须理解）：** E2EE 能防数据库泄露，但无法抵御已被攻陷的前端代码。若攻击者控制生产服务器并篡改前端 JS，理论上可诱导用户交出明文。项目通过「零第三方 JS / 零统计 / 零 CDN + 严格 CSP + 全站 HTTPS」缩小这一攻击面。

## 密钥层级

```
DEK（256-bit CSPRNG，首次初始化生成，仅存浏览器内存，sessionStorage 会话级持久化）
│
├── [wrapper: passkey_prf]
│     Passkey PRF 输出(32B) ──HKDF-SHA-256(salt=S, info="passkey-kek")──▶ Passkey KEK
│                            ──AES-256-GCM──▶ encrypted_dek（存服务器）
│
└── [wrapper: recovery]
      Recovery Key(256-bit 熵) ──HKDF-SHA-256(salt=salt_r, info="recovery-kek")──▶ Recovery KEK
                              ──AES-256-GCM──▶ encrypted_dek（存服务器）
```

- **DEK**：数据加密密钥，只在客户端内存，服务器永远拿不到。
- **S 不变量**：所有通行密钥共享同一个 PRF eval 输入 `S`（首个 wrapper 的 salt），保障多凭证一致；PRF 输出按凭证隔离——每把钥匙一个 wrapper。
- **恢复密钥**：服务器只存 `SHA-256(recovery key)` 十六进制哈希，256-bit 熵不可离线爆破。
- wrapper 的 `encrypted_dek` 存储格式：`base64( iv(12B) + AES-GCM 密文 )`。

## 目录结构

```
app/                    Next.js 路由与页面
  api/                  服务端接口（auth / diary / draft / keys / prefs / profile / prompts / weather / admin）
  (app)/                登录后区（route group，不产生 URL 段）：共享 layout 统一做解锁守卫 +
                        渲染底部 TabBar；组内页面 = 首页 / diary / entry/[id] / settings 及其子页
  login|setup|history   组外：认证流程与旧路由重定向（/history → /diary）
components/             React 组件（编辑器、列表、热力图、TabBar、各种弹窗）
lib/client/             客户端逻辑：crypto/（加密/KDF/PRF/恢复密钥/包装）、webauthn、session、
                        idb、draft-sync、location、geocode、weather、sound、streak、prefs、prompts
lib/server/             服务端逻辑：auth、session、webauthn、validation、ratelimit、
                        security-headers、proxy-guard、weather、db/（schema + 连接）
drizzle/                SQL 迁移文件（0000 ~ 0014；0013 = 结构化地名三级 + starred；0014 = 打开次数入库）
proxy.ts                Next 16 middleware（安全头 + 粗粒度路由保护）
scripts/                deploy.sh（一键部署）、generate-icons.js
docs/                   设计文档、安全审计、手动测试清单、部署示例
tests/                  Vitest 测试（crypto / draft-sync / ratelimit / validation / webauthn / api-protection）
```

## 数据模型（Drizzle → PostgreSQL）

| 表 | 作用 | 关键点 |
|---|---|---|
| `credentials` | 通行密钥凭证 | `credential_id` 唯一、`counter` 防重放、`disabled` 软禁用、`device` 标识设备 |
| `key_wrappers` | 密钥包装行 | 每凭证一条 `passkey_prf`（唯一索引）+ 全局一条 `recovery`；`recovery_key_hash` 用于灾难恢复登录 |
| `diary_entries` | 日记条目 | 仅 `ciphertext` + `iv` + 元数据（经纬度 / 结构化地名三级 / 旧地名串 / 天气 / 时区 / 字数 / 收藏 / **打开次数** / 时间戳），无明文列 |
| `drafts` | 单行草稿 | 同样只存 `ciphertext` + `iv` |
| `user_prefs` | 偏好开关 | 存数据库以便多端同步，非 localStorage。**只收布尔（`'0'`/`'1'`）**——导出格式记忆等设备本地偏好刻意不进该表 |
| `prompt_stats` | 每日提示展示统计 | `prompt_id`（p_0..p_99）计数 |

> 注意：经纬度、结构化地名、天气、收藏状态、打开次数等元数据 **不在加密范围内**（设计如此）。数据库泄露会暴露位置轨迹、"哪几篇被收藏"以及"每篇回看过几次"，但不暴露正文。
>
> 「打开次数」是**数据库列**（`view_count`，migration 0014），语义是「我自己打开这一篇看过几次」。它由服务器原子自增（`view_count = view_count + 1`）、只 `set` 这一列 ⇒ **不刷新 `updatedAt`**，所以回看不会被误判成「编辑」。旧的纯本机 IndexedDB 计数**刻意不迁移**（它按设备计，写进库等于冒充全局真值，一律从 0 起算）。
>
> `location_name`（单一地名串）已废弃，只有 0013 之前写入的老数据有值；读路径只作展示兜底，老条目在详情页被打开时会自动重新反查并升级为结构化三级（见 `lib/client/location.ts`）。

## API 端点

**公开（认证流程所需）**
- `POST /api/auth/register/options`、`POST /api/auth/register`
- `POST /api/auth/login/options`、`POST /api/auth/login`
- `POST /api/auth/recovery-login`、`GET /api/auth/session`、`POST /api/auth/logout`

**需要登录（`requireAuth` 拦截，未登录 401）**
- `GET|POST /api/diary`、`GET|PATCH|DELETE /api/diary/[id]`
  （列表支持两套分页：`offset` 与 **`before`/`beforeId` 游标**（(created_at,id) 元组比较，
  供「滑到底自动加载」与「按某天取一页」）；反方向的 `after` 已于 2026-10-02 随列表页日期功能一并移除）
- `POST /api/diary/[id]/view`（打开次数 +1，服务器原子自增；只写 `view_count` 一列，不碰 `updatedAt`）
- `POST /api/diary/import`（批量导入，允许客户端指定 createdAt/updatedAt 以保留原始时间）
- `GET /api/diary/stats`、`GET /api/diary/on-this-day`
- `GET|PUT|DELETE /api/draft`
- `GET|POST /api/keys/wrappers`、`PUT /api/keys/wrappers/recovery`
- `GET|POST /api/keys/passkeys`、`DELETE /api/keys/passkeys/[id]`、`POST /api/keys/passkeys/[id]/enable`
- `GET|PUT /api/prefs`、`POST /api/prompts/record`、`GET /api/weather`
- `POST /api/admin/wipe`（额外限流）

## 安全设计要点

- **会话**：`qo_session` 是 HS256 签名 JWT，payload 仅 `{ sub, iss, aud, iat, exp }`，httpOnly + SameSite=Lax + 生产 Secure。JWT 绑定登录凭证——禁用某设备，该设备所有已登录会话立即失效。
- **CSRF**：SameSite=Lax + Origin 校验双保险。
- **限流**：单实例内存滑动窗口（登录 / 注册 / 写日记 / wipe 等）。
- **安全头**（`lib/server/security-headers.ts`）：CSP（生产 `default-src 'self'`）、`nosniff`、`no-referrer`、`X-Frame-Options: DENY`、`Permissions-Policy` 收紧位置/摄像头/麦克风等。
- **proxy.ts（Next 16 middleware）**：为所有页面响应注入安全头，并对 `/`、`/diary`、`/history`、`/entry/*`、`/settings/*` 做单向粗粒度重定向。**不做**「已登录 → /login」跳转，因为 DEK 仅在内存、刷新即失，`/login` 必须恒可达（否则死循环）；已登录跳转由客户端守卫负责。
  > route group `(app)` 不改变 URL，因此新增组内页面时 matcher 与 `proxy-guard.ts` 的 `protectedPaths` 都不需要改；但**新增/改名的真实路径两处都必须登记**，`tests/proxy-matcher-coverage.test.ts` 会守住这条（它已能正确跳过 `(app)` 这类分组目录）。
- **零日志**：全项目无 `console` 输出，请求体 / 密钥 / PRF 输出不落日志。
- **第三方数据流向**：

| 服务 | 用途 | 数据流向 | 调用方 |
|---|---|---|---|
| BigDataCloud | 经纬度 → 结构化地名（省/市/区）反查 | 坐标**模糊到 ≈1km** 后发送给该服务 | 浏览器直调（结果按格子缓存在本地 IndexedDB） |
| 和风天气 QWeather | 保存时记录实时天气 | 坐标发送（服务器代理，JWT 认证） | 服务器 |
| W3C Geolocation | 获取坐标 | 浏览器原生能力 | 浏览器 |

## 环境变量

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `WEBAUTHN_RP_ID` | WebAuthn 依赖方 ID，**必须与访问域名一致** |
| `WEBAUTHN_RP_NAME` | 显示名称 |
| `WEBAUTHN_ORIGIN` | 站点完整 URL |
| `SESSION_SECRET` | 会话签名密钥，≥32 字符 |
| `RECOVERY_KEY_VERSION` | 加密方案版本（默认 1） |
| `QWEATHER_KID` / `QWEATHER_SUB` | 和风天气 JWT 凭据 ID / 项目 ID（可选，不配则天气停用） |
| `QWEATHER_PRIVATE_KEY` | 和风天气 Ed25519 私钥（只存服务器） |
| `QWEATHER_HOST` | 和风控制台分配的专属 API Host |

> WebAuthn 要求 HTTPS（localhost 除外）。`WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` 必须与浏览器地址栏完全一致，否则创建/登录通行密钥会失败。

## 开发与部署

```bash
# 开发
npm install
cp .env.example .env.local      # 填写真实值
for f in drizzle/000*.sql; do psql "$DATABASE_URL" -f "$f"; done   # 依次执行迁移
npm run dev                     # http://localhost:3000

# 常用脚本
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest run
npm run build       # 生产构建

# 生产部署（推荐：本地构建产物上传，服务器无需构建工具链）
export REMOTE_HOST=myserver
export REMOTE_UPDATE=/path/to/update.sh
bash scripts/deploy.sh
```

部署流程：同步代码 → 注入版本号 → 本地 `npm ci && npm run build` → 打包上传 → 服务器解压 + `pm2 restart` → HTTP 验证。服务器端只需 Node.js 20+、PM2、PostgreSQL、解压工具。新增迁移只需执行对应的 `drizzle/000X_*.sql`。

## 快速使用

> 登录后的三块内容由**底部导航栏**切换（当前 tab 高亮）；「写」「设置」是 tab 目的地、
> 页头无返回箭头，`/entry/*` 与 `/settings/*` 子页保留返回箭头。

1. **首次访问** → 初始化：创建通行密钥 → 保存恢复密钥 → 完成。
2. **写**（首页）→ 输入即自动存草稿 → 点「保存」落库（可记录位置/天气）。
3. **日记** → 固定区（标题栏 + 统计行 + 写作频率热力图）+ 内部滚动区（按日分组列表）→ 点条目进详情
   （底部操作栏 4 个图标：打开次数 · 收藏 · 编辑 · 删除；地点名在上方，点它复制坐标）。
   向下滑则**自动加载**更早的日记（`before` 游标分页，已无「加载更多」按钮）。
   右上角 🔍 搜索：关键词 + 三类筛选（时间：**全部时间 / 具体日期**（日历选某一天）；收藏：全部/仅收藏；
   地点：无位置/具体地点），可任意组合（恒为交集）。筛选控件顺序＝时间 → 地点 → 收藏；
   收藏为即时开关，文字恒定、只用颜色表达选中（2026-10-02 用户要求）。
   > 「按日期看日记」走的是**搜索的时间档**（历史：2026-10-02 曾在列表页做过日期胶囊 + 锚定窗口 + 双向游标，
   > 真机上滚动补偿不稳，当天整体删除并把日期筛选收敛到搜索面板——那边本来就是全量解密后本地筛，按天筛更准）。
4. **详情页** → 底部操作栏左组是这一篇的**状态**（打开次数 · 收藏），右组是对**页面**的操作（编辑 / 删除）；
   「编辑于」固定在操作栏分割线正**上方**（未编辑过则不显示，也不随正文上浮）。
5. **设置** → 个人信息与名字、通行密钥管理、重生成恢复密钥、偏好设置、导出与导入、退出登录、删除全部数据。
   偏好设置（弹窗）含：保存时记录位置 · 保存时记录天气 · 自动补全地点名 ·
   显示连续写作天数 · 显示每日提示 · 显示去年的今天 ·
   显示打开次数 · 显示写作热力图 · 保存音效 · 离线缓存。
   > 布尔类偏好走 `/api/prefs` 多端同步；**离线缓存、导出格式记忆**为设备属性，
   > 刻意只存本地（`lib/client/prefs.ts` 的 `ALL_KEYS` 与 `app/api/prefs/route.ts` 的
   > `PREF_KEYS` 白名单由 `tests/prefs.test.ts` 对账）。
   > 主题外观刻意不做成偏好（2026-10-01 用户拍板）：应用恒跟随系统
   > `prefers-color-scheme`，全部 `dark:` 工具类走 Tailwind 默认媒体查询。

## 许可证

[MIT](../LICENSE)
