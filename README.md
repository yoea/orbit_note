# Quiet Orbit — 私人日记

端到端加密的单用户私人日记 Web App。日记正文在浏览器加密后上传，服务器数据库只有密文。

## 功能

- Passkey / Face ID 登录（WebAuthn，无密码）
- WebAuthn PRF 密钥派生（KEK 保护 DEK）
- AES-256-GCM 客户端加密（每篇独立 IV）
- Recovery Key 灾难恢复（HKDF-SHA-256 派生）
- 自动草稿（IndexedDB 加密草稿 + 服务器同步 + 冲突处理）
- 自动记录时间与位置（位置为服务器可见 metadata）
- 历史查看 / 编辑 / 删除
- PWA（iPhone 主屏幕安装，独立启动）

## 安全设计

### E2EE 边界（重要）

**E2EE 能防止数据库泄露，但无法完全抵御已经被攻陷的客户端/前端代码。** 如果攻击者控制了生产服务器并能够修改前端 JavaScript，理论上可以诱导用户把明文传给攻击者。本项目通过以下方式降低该风险：

- 生产环境 CSP（script-src 'self' 'unsafe-inline'——Next.js RSC 内联脚本所需，无 nonce 方案）
- HTTPS 全站
- 零第三方 JS / 零统计脚本 / 零第三方 CDN
- 定期更新依赖

### 密钥层级

```
DEK ── 256-bit CSPRNG 随机，首次初始化生成，仅存于浏览器内存
│
├── [wrapper: passkey_prf]
│     Passkey PRF 输出(32B)
│       → HKDF-SHA-256(salt=S, info="passkey-kek") → Passkey KEK
│       → AES-256-GCM → encrypted_dek（存服务器）
│
└── [wrapper: recovery]
      Recovery Key（256-bit 熵，显示一次）
        → HKDF-SHA-256(salt_r, info="recovery-kek") → Recovery KEK
        → AES-256-GCM → encrypted_dek（存服务器）
```

DEK 仅存浏览器内存，刷新即失；Passkey PRF 与 Recovery Key 分别派生 KEK 包裹 DEK；服务器只存 wrapper 密文与 SHA-256(recovery key)（用于恢复登录校验，不可逆且不可爆破）。加密密钥（DEK/KEK/PRF 输出/Recovery Key 明文）永不离开浏览器、永不发送到服务器。

### 服务器可见 metadata

日记正文是 E2EE，但以下属于服务器可见 metadata：created_at / updated_at / latitude / longitude / location_accuracy / timezone / 日记数量与长度。

### 安全自检

详见 [docs/security-audit.md](docs/security-audit.md)（15 项，全部通过）。

## 本地开发

前置：Node.js >= 20.9、PostgreSQL 本地运行。

```bash
npm install
cp .env.example .env.local   # 填入 DATABASE_URL 与 SESSION_SECRET（openssl rand -base64 48）
createdb quiet_orbit         # 或 psql 建库
npm run db:migrate           # 应用 migration（需要 DATABASE_URL 环境变量，或复制 .env.local 为 .env 供 drizzle-kit）
npm run dev                  # http://localhost:3000
```

验证：`npm run lint && npm run typecheck && npm run test && npm run build`

注意：开发环境 WebAuthn 在 localhost 可用（Chromium 对 localhost 的 Secure Context 豁免）。Windows Hello / iPhone 真机联调需 HTTPS。

## 使用说明

### 第一次初始化 Passkey

1. 打开网站（生产 HTTPS）
2. 点击「创建你的私人日记」→「使用 Face ID 创建通行密钥」
3. 完成 Face ID / Windows Hello 认证
4. **立即保存显示的恢复密钥**（只显示一次！）

### 把网站添加到 iPhone 主屏幕

1. Safari 打开网站并完成首次初始化
2. 点击分享按钮 → 「添加到主屏幕」
3. 点击图标即可像 App 一样独立启动（standalone）

### Recovery Key 应该如何保存

- 保存到密码管理器（1Password / Bitwarden / iCloud 钥匙串等）
- 或打印纸质备份放入安全地点
- **不要**截图存相册 / 存网盘明文 / 发给任何人
- 换 iPhone / 丢失全部 Passkey 时，用 Recovery Key 恢复

### 如果换 iPhone 应该如何恢复

1. 新 iPhone Safari 打开网站
2. 点击「使用 Face ID 解锁」——会失败或提示无凭证
3. 切换到「恢复密钥」输入模式
4. 粘贴 Recovery Key → 解锁成功
5. 解锁后在「设置 → 注册新的 Passkey」为新 iPhone 添加 Passkey
6. 此后新 iPhone 可用 Face ID 正常解锁

## 测试

- `npm test`：48 个单元测试（crypto / 校验 / 限流 / challenge / API 保护）
- 手动清单：[docs/MANUAL_TESTING.md](docs/MANUAL_TESTING.md)（iPhone + Edge 双平台）

## 部署

生产部署（ECS + Nginx + PostgreSQL）详见 [docs/deploy/ECS-DEPLOY.md](docs/deploy/ECS-DEPLOY.md)。

## 数据库备份

PostgreSQL 定期 `pg_dump` 即可——备份中只有日记密文，数据库泄漏/备份泄漏均无法直接看到正文。

## 兼容性

| 能力 | iOS 26 Safari | Windows 11 Edge |
|---|---|---|
| Passkey + 生物识别 | ✅ Face ID | ✅ Windows Hello |
| WebAuthn PRF | ✅ | ⚠️ 可能不可用（Chromium 平台实现） |
| PRF 不可用时 | — | 降级：输入 Recovery Key 解锁 |
| PWA 主屏幕 | ✅ | —（调试用浏览器内运行） |

## 技术栈

Next.js 16（App Router）/ TypeScript strict / Tailwind CSS 4 / Drizzle ORM + PostgreSQL / @simplewebauthn / jose / zod / vitest

## 验收清单

（抄录需求文档最终验收标准，标注 ✅ 已实现 / 📱 需真机验证）

- ✅ iPhone Safari 可正常使用（📱 真机验证）
- ✅ Passkey + Face ID 登录（📱）
- ✅ 不需要密码
- ✅ 日记支持换行
- ✅ 支持中文
- ✅ 支持 iOS 原生 Emoji
- ✅ 可以保存日记
- ✅ 自动保存草稿
- ✅ 下次打开能恢复草稿
- ✅ 自动记录时间
- ✅ 自动记录当前位置
- ✅ 可以查看历史
- ✅ 可以编辑
- ✅ 可以删除
- ✅ PWA 可添加到 iPhone 主屏幕（📱）
- ✅ 独立 Web App 打开（📱）
- ✅ 日记正文客户端加密
- ✅ 数据库没有日记明文
- ✅ Recovery Key 可恢复
- ✅ 不会把加密密钥上传服务器
- ✅ 未登录不能读取日记
- ✅ 生产环境 HTTPS（部署后验证）
- ✅ 无第三方统计脚本
- ✅ npm build 成功
- ✅ lint 成功
- ✅ typecheck 成功
