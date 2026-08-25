# 私人日记 PWA — 设计文档（Quiet Orbit）

> 日期：2026-08-25
> 状态：已批准
> 来源需求：`thisismyneed.md`（43 章详细需求）

## 1. 项目定位

单用户私人日记 Web App，iPhone Safari / PWA 日常使用，Windows 11 Edge 调试。

**优先级**：安全 > 稳定 > 极简 > 开发成本。

**核心承诺**：日记正文明文永不离开浏览器。服务器只能看到 AES-256-GCM 密文。

## 2. 技术栈（最小依赖）

| 类别 | 选择 | 理由 |
|---|---|---|
| 框架 | Next.js（App Router）+ TypeScript strict | 文档指定 |
| 样式 | Tailwind CSS | 文档指定 |
| ORM | **Drizzle** + drizzle-kit | 无二进制引擎、ECS 部署零负担、类型安全；本项目仅 4 张表，Prisma 过剩 |
| DB 驱动 | `postgres` (postgres.js) | 纯 JS、轻量 |
| WebAuthn | `@simplewebauthn/server` + `@simplewebauthn/browser` | 文档指定，成熟协议实现 |
| Session | `jose` 签名 cookie（JWT） | 轻量、自托管、HttpOnly/Secure/SameSite=Lax |
| 校验 | `zod` | 所有 API 请求体校验 + 长度限制 |
| 测试 | vitest | 单元测试（crypto/密钥派生） |
| 开发数据库 | 本机 PostgreSQL（端口 5432，凭据见 `.env`，不入 git） | 用户已提供 |

**明确不引入**：第三方 CDN JS、字体、统计脚本、Markdown、富文本、任何重型状态库。

## 3. 目录结构

```
quiet_orbit/
├── app/
│   ├── page.tsx                    # / 首页：大 textarea + 保存
│   ├── login/page.tsx              # /login：Face ID 解锁 / Recovery Key 降级
│   ├── setup/page.tsx              # /setup：首次初始化（仅当无 credential 时可达）
│   ├── history/page.tsx            # /history：按日期倒序列表
│   ├── entry/[id]/page.tsx         # /entry/[id]：详情 + 编辑 + 删除
│   ├── settings/page.tsx           # /settings：Passkey 管理 / Recovery Key / 登出 / 清空
│   ├── layout.tsx                  # 根布局（viewport、manifest、meta）
│   └── api/
│       ├── auth/register/route.ts  # POST：初始化注册 + 设置页添加新 Passkey
│       ├── auth/login/route.ts     # POST：WebAuthn 认证
│       ├── auth/logout/route.ts    # POST
│       ├── auth/session/route.ts   # GET：初始化状态 + 会话状态
│       ├── diary/route.ts          # GET 列表 / POST 新建
│       ├── diary/[id]/route.ts     # GET / PATCH / DELETE
│       ├── draft/route.ts          # GET / PUT
│       └── keys/wrappers/route.ts  # GET 全部 wrapper / POST 新 wrapper
├── lib/
│   ├── server/
│   │   ├── env.ts                  # 环境变量统一读取（zod 校验）
│   │   ├── db/schema.ts            # Drizzle schema
│   │   ├── db/index.ts             # postgres 连接
│   │   ├── webauthn.ts             # register/login 生成 + 验证（@simplewebauthn）
│   │   ├── session.ts              # jose 签发/验证 cookie
│   │   ├── validation.ts           # zod schemas
│   │   ├── ratelimit.ts            # 内存滑动窗口
│   │   └── security-headers.ts     # CSP 等响应头
│   └── client/
│       ├── crypto/kdf.ts           # HKDF-SHA-256 派生 KEK
│       ├── crypto/encryption.ts    # AES-256-GCM 加解密 + DEK 内存管理
│       ├── crypto/recovery-key.ts  # 生成/校验 Recovery Key
│       ├── webauthn.ts             # PRF 注册/认证浏览器端封装
│       ├── idb.ts                  # IndexedDB 封装（草稿、缓存）
│       ├── draft-sync.ts           # 草稿防抖 + 本地/服务器同步 + 冲突策略
│       ├── location.ts             # 定位封装（允许/拒绝/失败都不阻塞保存）
│       └── session.ts              # 客户端会话状态
├── components/                     # 移动端优先 UI
├── public/manifest.webmanifest
├── public/icons/                   # 自绘 PNG 图标（180/192/512 + apple-touch-icon）
├── middleware.ts                   # 路由保护 + 安全响应头
├── drizzle/                        # migration SQL
├── docs/deploy/                    # 生产部署说明
└── README.md
```

## 4. 密钥层级（核心安全设计）

```
DEK ── 256-bit CSPRNG 随机，首次初始化生成，仅存于浏览器内存（Js 变量）
│
├── [wrapper: passkey_prf]
│     Passkey PRF 输出(32B)
│       → HKDF-SHA-256(salt_p, info="passkey-kek", len=32) → Passkey KEK
│       → AES-256-GCM(KEK, iv_k) → encrypted_dek     （存服务器）
│
├── [wrapper: passkey_prf]  （未来第二个 Passkey，key_wrappers 多行支持）
│
└── [wrapper: recovery]
      Recovery Key（256-bit 熵，显示一次）
        → HKDF-SHA-256(salt_r, info="recovery-kek", len=32) → Recovery KEK
        → AES-256-GCM(KEK, iv_k) → encrypted_dek     （存服务器）
```

- **正常解锁**：Face ID → Passkey → PRF 输出 → Passkey KEK → 解密 DEK
- **灾难恢复**：Recovery Key → Recovery KEK → 解密 DEK（PRF 不可用时也走此路径）
- **登录后**：DEK 留在浏览器内存，用于解密所有日记正文与草稿
- **永不离开浏览器**：DEK 明文、KEK、PRF 输出、Recovery Key 明文

### 日记正文加密

- `AES-256-GCM`，每篇日记独立 96-bit 随机 IV（`crypto.getRandomValues`）
- 数据库字段：`ciphertext`、`iv`、`encryption_version=1`
- 草稿与正文同一加密体系
- 密钥层级需在代码注释中明确说明（文档第七节要求）

## 5. 数据库 Schema（Drizzle）

全部 `timestamptz`（UTC）存储，单用户无 user_id 外键。

```sql
credentials (
  id            uuid pk default gen_random_uuid()
  credential_id text unique not null   -- base64url
  public_key    text not null
  counter       bigint not null
  transports    jsonb
  created_at    timestamptz not null default now()
  last_used_at  timestamptz
)

key_wrappers (
  id                uuid pk
  wrapper_type      text not null          -- 'passkey_prf' | 'recovery'
  credential_id     text null              -- 仅 passkey_prf；recovery 为 null
  encrypted_dek     text not null          -- base64（含 authTag）
  salt              text not null          -- HKDF salt（base64）
  encryption_version int not null default 1
  created_at        timestamptz not null default now()
)

diary_entries (
  id                 uuid pk
  ciphertext         text not null         -- base64
  iv                 text not null         -- base64, 96-bit
  encryption_version int not null default 1
  latitude           double precision null
  longitude          double precision null
  location_accuracy  double precision null
  timezone           text null             -- IANA tz，如 Asia/Shanghai
  created_at         timestamptz not null default now()
  updated_at         timestamptz not null default now()
)

drafts (
  id                 uuid pk               -- 单用户固定行
  ciphertext         text not null
  iv                 text not null
  encryption_version int not null default 1
  updated_at         timestamptz not null default now()
)
```

说明：文档第 10 节建议单行 `encryption_keys`，本设计改为多行 `key_wrappers`——理由：第 34/35 节要求支持多 Passkey 多 wrapper，多行结构免 ALTER TABLE，且解锁只需任一 wrapper 成功。

## 6. WebAuthn / 初始化流程

### 首次初始化（/setup，仅当 credentials 表为空时可达）

1. 浏览器生成随机 DEK（256-bit）与 Recovery Key（256-bit）
2. `navigator.credentials.create`（`prf` 扩展，RP ID = 正式域名）
3. 若 PRF 被接受：派生 Passkey KEK → 生成 wrapper_p
4. 生成 Recovery KEK → 生成 wrapper_r
5. 服务端验证注册 assertion，保存 credential + 两个 wrapper
6. 设置 session cookie
7. 显示 Recovery Key（仅此一次，可复制），进入首页
8. 若浏览器不支持 PRF：跳过 wrapper_p，仅存 wrapper_r（仍必须显示 Recovery Key）

### 登录（/login）

1. `navigator.credentials.get`（带 `prf` 扩展，allowCredentials 为空=任意已注册）
2. 服务端验证 assertion（challenge、credentialId、counter 递增、origin、rpId）
3. 设置 session cookie
4. 客户端：PRF 返回结果 → 派生 KEK → 尝试解密 wrapper_p
5. 若 PRF 无结果（浏览器不支持）→ 提示输入 Recovery Key → 解密 wrapper_r
6. 解锁成功，DEK 进入内存，进入首页

### 注册新 Passkey（/settings）

- 仅已有 credential 时可调用（用户已登录）
- 新 credential 的 PRF wrapper 通过 `POST /api/keys/wrappers` 保存（需认证）
- Recovery wrapper 不变

### 防滥用

- 数据库已存在任意 credential 时，`/api/auth/register` 返回 403
- `/setup` 页面在已初始化时重定向到 /login
- 所有 diary/draft API 无 session 一律 401

## 7. Session 与 API 安全

- **Cookie**：`session` JWT（jose HS256，`SESSION_SECRET`≥32B），HttpOnly + Secure + SameSite=Lax，Path=/，无密钥材料
- **CSRF**：SameSite=Lax + 服务端校验 `Origin`/`Sec-Fetch-Site` 头
- **Rate limit**：内存滑动窗口（默认 20 req/min/IP，注册登录更严），单用户够用
- **输入校验**：所有请求体 zod 校验；服务器**忽略**客户端传入的 id/created_at/updated_at/location 字段（位置由服务器从请求头 Geo 数据以外的真实来源获取——实际方案：客户端只传经纬度/精度数字，经 zod 范围校验；时间戳一律服务器生成）
- **长度限制**：正文密文 ≤ 200KB，其余字段按类型限定
- **CSP**（middleware 注入）：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
  - Tailwind 需要 `style-src 'unsafe-inline'`（开发模式）；生产考虑非内联样式，但为简单保持 'unsafe-inline'（仅 style，无 script 内联；Next 生产 build 默认无内联 script 依赖）
- **XSS**：正文一律 React 默认文本渲染 / `textContent`，换行用 `white-space: pre-wrap`，零 dangerouslySetInnerHTML
- **日志**：任何日志不输出 request body、ciphertext、密钥、Recovery Key；生产关闭 verbose

## 8. 定位（敏感 metadata，明确边界）

- 保存时 `navigator.geolocation.getCurrentPosition`，失败/拒绝不阻塞保存
- 权限说明文案："保存日记时记录当前位置，仅用于记录你当时在哪里。"
- 存储 latitude/longitude/accuracy；无逆地理编码；不调用任何地图 API
- 详情页显示"记录了当前位置"，点击显示坐标
- **代码注释 + README 明确**：正文是 E2EE，但经纬度/时间戳是服务器可见 metadata

## 9. 草稿（IndexedDB + 服务器同步）

- textarea 输入 → 500ms debounce → 客户端加密 → IndexedDB（先）→ 服务器同步（后）
- IndexedDB 只存密文 + iv + 版本 + 时间戳，**明文只存在于内存**
- 打开页面检测本地/服务器草稿 → 显示"发现上次未完成的日记" → 恢复 / 放弃
- 冲突策略：保留 updated_at 较新者，界面明确提示，不静默覆盖
- 保存成功后清空本地草稿并通知服务器删除
- 离线：IndexedDB 可读写，网络恢复自动同步（visibilitychange/online 事件 + 页面加载时兜底）

## 10. UI（移动端第一，Apple Notes 风格）

- 首页：顶部"我的日记"+ 右上设置；巨大 textarea（placeholder "写下此刻……"，自动增长、自动聚焦、防键盘遮挡、safe-area 适配）；底部状态"已保存"/"正在保存…" + 保存按钮
- 保存成功："已保存 · 22:36"，清空输入框
- 历史：按日期分组倒序（2026-08-25 → 22:36 + 预览首行）
- 详情：日期/时间/地点 + 正文（pre-wrap）+ 编辑/删除（二次确认）
- 设置：Passkey 状态 + 注册新 Passkey、导出/重新生成 Recovery Key、退出登录、删除所有数据（二次确认）、关于
- 深色/浅色自适应（`prefers-color-scheme`）；`theme-color` 同步；防双击缩放；无横向滚动；大触摸区域（≥44px）
- 全部中文文案

## 11. PWA

- `manifest.webmanifest`：name/short_name/start_url/display:standalone/theme_color/background_color/icons
- iOS meta：`apple-touch-icon`、`apple-mobile-web-app-title`、`apple-mobile-web-app-capable`、`viewport-fit=cover`
- Service Worker（next-pwa 或手写 `public/sw.js`）：仅缓存静态资源（JS/CSS/图标/manifest），**绝不缓存日记密文**（日记数据走 IndexedDB）
- 图标：自绘简单图标（PNG 180/192/512），无外部资源

## 12. 兼容性边界（如实声明）

| 能力 | iOS 26 Safari | Windows 11 Edge（调试） |
|---|---|---|
| Passkey + 生物识别 | ✅ Face ID | ✅ Windows Hello |
| WebAuthn PRF | ✅ | ⚠️ 可能不可用（Chromium 平台实现） |
| PRF 不可用时 | — | 降级：输入 Recovery Key 解锁 |
| PWA 主屏幕 | ✅ | ✅（调试用浏览器内运行） |

运行时以 PRF 扩展是否返回结果判定解锁路径。恢复密钥解锁在两类平台安全等价（同为 HKDF 派生 KEK 解密同一 DEK wrapper）。

## 13. 测试

**单元（vitest，浏览器环境 jsdom 或 happy-dom + WebCrypto 支持）**：
- kdf：HKDF 派生正确性、salt 差异 → 密钥差异
- encryption：加密/解密往返、篡改 ciphertext 必须失败、篡改 IV 必须失败、错误 key 必须失败、GCM auth tag 校验
- recovery-key：生成熵 ≥256bit、显示格式、校验
- draft-sync：防抖、本地优先、冲突取新、清空逻辑

**API（Next 测试或直接调 handler）**：
- 未认证 401、初始化前注册成功、已初始化再注册 403、登录失败、counter 复用拒绝、IDOR（删他人 id 返回 404）、删除需认证、zod 拒绝畸形请求

**手动清单**：文档第 36 节全部场景（iPhone 真机 + Edge 双平台）。

## 14. 环境变量

```
DATABASE_URL=postgres://postgres:***@localhost:5432/quiet_orbit
WEBAUTHN_RP_ID=diary.example.com        # 正式域名
WEBAUTHN_RP_NAME=我的日记
WEBAUTHN_ORIGIN=https://diary.example.com
SESSION_SECRET=<随机 ≥32B>
RECOVERY_KEY_VERSION=1
NODE_ENV=production
```

开发环境 RP ID/Origin 用 `localhost` 配置。**严禁**把 Passkey 私钥、加密密钥、Recovery Key 写入环境变量（文档第 41 节）。`.env.example` 提供模板，`.env` 不入 git。

## 15. 开发顺序（Phase）

1. **Phase 1** 基础架构：create-next-app、TS strict、Tailwind、目录、lint/typecheck/build 基线
2. **Phase 2** 数据库：Drizzle schema + migration + 本机 PostgreSQL 建库
3. **Phase 3** WebAuthn：register/login/logout/session API + 初始化流程
4. **Phase 4** E2EE：客户端 crypto 模块（kdf/encryption/recovery-key）+ 完整测试
5. **Phase 5** Diary CRUD API
6. **Phase 6** 首页编辑器 + 保存流程
7. **Phase 7** 历史列表 + 详情/编辑/删除
8. **Phase 8** 草稿：防抖、IndexedDB、同步、冲突、恢复
9. **Phase 9** 定位
10. **Phase 10** PWA：manifest、icons、Service Worker、iOS meta
11. **Phase 11** 安全加固：CSP、rate limit、日志清理、安全自检（文档第 37 节 15 项）
12. **Phase 12** 测试补全 + 手动清单
13. **Phase 13** 部署文档（ECS + Nginx + PM2/systemd + HTTPS + 备份）与 README

每个 Phase 结束运行 `npm run lint && npm run typecheck && npm run build`，全部通过后进入下一 Phase。

## 16. 最终验收（文档"最终验收标准"25 项）

以文档第 1491–1521 行清单为准，全部打勾才算完成。
