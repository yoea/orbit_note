# 安全自检报告（Task 13 · 文档第 37 节 15 项）

检查日期：2026-08-26
检查范围：全项目（`app/`、`lib/`、`components/`、`scripts/`、`docs/`）
结论：**15/15 通过**（其中 2 项为"设计如此"的可接受风险，见第 6、15 项说明）

---

## 1. 数据库是否存在任何日记明文？—— 通过

- 检查方法：阅读 `lib/server/db/schema.ts` 全部表定义。
- 结论：`diary_entries` 仅存 `ciphertext`（AES-256-GCM 密文，base64）、`iv`、`encryption_version` 及元数据（经纬度/时区/时间戳），无任何明文正文列。`drafts` 同理（仅 ciphertext/iv）。

## 2. API 是否存在任何明文返回？—— 通过

- 检查方法：grep 全部 `app/api/**/route.ts` 的响应体构造（`NextResponse.json(...)`），确认无解密端点、无明文正文字段。
- 结论：所有 diary/draft/keys API 只返回密文行（ciphertext/iv 原样透传）或元数据。不存在服务端解密逻辑（解密只在客户端 `lib/client/crypto/` 完成）。

## 3. 日记是否在客户端加密后才上传？—— 通过

- 检查方法：阅读 `app/entry/[id]/page.tsx` 的 `saveEdit` 流程与 `app/api/diary/route.ts`（POST）。
- 结论：`encryptText(dek, plain)` 在浏览器内完成加密，仅上传 `{ ciphertext, iv }`（zod `diaryCreateSchema` 拒绝明文类字段）。列表/历史页解密在客户端 `decryptText` 完成。

## 4. DEK 是否可能进入服务器？—— 通过

- 检查方法：grep 全项目 `setDek/getDek/exportKey` 与 fetch 请求体。
- 结论：DEK（CryptoKey）仅存在于 `lib/client/session.ts` 模块级内存变量，刷新即清空；上传的只有 wrapper 的 `encryptedDek`（DEK 被 KEK 加密后的密文）。服务端 schema `key_wrappers.encrypted_dek` 存的是密文。

## 5. PRF 输出是否可能进入服务器日志？—— 通过

- 检查方法：grep `console.log/error/warn/debug`（见第 13 项）。
- 结论：全项目零 console 输出，PRF 输出（`prfResult`）只存在于客户端内存并立即经 HKDF 派生 KEK，无任何日志、无任何网络传输（服务器从不接收 PRF 输出）。

## 6. Recovery Key 是否可能进入服务器？—— 通过（仅存不可逆哈希）

- 检查方法：grep `recoveryKeyHash/sha256Hex`，阅读 `app/api/auth/recovery-login/route.ts` 与 wrapper 保存路径。
- 结论：Recovery Key（256-bit CSPRNG，base64url 43 字符）明文永不离开浏览器；服务器仅保存 `SHA-256(recovery key)` 十六进制哈希（`key_wrappers.recovery_key_hash`、`recovery-login` 校验用）。256-bit 熵使哈希不可爆破。
- 例外：`/api/auth/recovery-login` 的请求体含恢复密钥明文，但仅用于即时哈希比对，不落库、不写日志。可接受。

## 7. localStorage 是否保存明文日记？—— 通过

- 检查方法：grep `localStorage/sessionStorage` 全部用法。
- 结论：localStorage 零使用；sessionStorage 仅存 UI 标记（`components/DiaryEditor.tsx` 的 `'qo-location-notice-shown'`——位置提示是否已显示），无日记内容。离线草稿存于 IndexedDB（`lib/client/idb.ts`），且只存加密后的 ciphertext/iv（客户端加密后才写入）。

## 8. Cookie 是否保存敏感密钥？—— 通过

- 检查方法：阅读 `lib/server/session.ts`（JWT payload 结构）与各 route 的 set-cookie。
- 结论：`qo_session` 是 HS256 签名的 JWT，payload 仅 `{ sub: 'owner', iss, aud, iat, exp }`，不含任何密钥材料、不含 DEK/恢复密钥。httpOnly + sameSite=lax + 生产 secure。

## 9. 是否存在 XSS？—— 通过

- 检查方法：grep `dangerouslySetInnerHTML`。
- 结论：零使用（全项目无匹配，仅规格/计划文档文字提及）。正文一律 React 默认文本渲染，换行用 CSS `white-space: pre-wrap`。配合 CSP（生产无 `unsafe-inline` script、无 `unsafe-eval`）双重防御。

## 10. 未登录能否调用 diary API？—— 通过

- 检查方法：逐文件核查 `app/api/diary/**`、`app/api/draft/**`、`app/api/keys/**` 全部 handler。
- 结论：所有 handler 第一行即 `requireAuth`/`isAuthed`（401 拦截）：
  - `diary` GET/POST、`diary/[id]` GET/PATCH/DELETE、`draft` GET/PUT/DELETE、`keys/wrappers` GET/POST、`keys/wrappers/recovery` PUT、`admin/wipe` POST —— 全覆盖。
  - 公开端点仅：`auth/login|register|session|logout|recovery-login|login/options|register/options`（认证流程所需，`login/options`/`register/options` 带 rate limit）。

## 11. 是否存在 IDOR？—— 通过

- 检查方法：阅读 `app/api/diary/[id]/route.ts` 的 `parseId` 与各查询。
- 结论：单用户系统（无用户维度），日记 ID 必须匹配严格 uuid 正则（否则 404），不存在越权访问他人资源的路径。

## 12. 删除 API 是否需要认证？—— 通过

- 检查方法：grep DELETE 方法。
- 结论：`diary/[id]` DELETE 与 `admin/wipe` POST 均先 `requireAuth`（未登录 401）。wipe 另加 rate limit（3 次/分钟）。客户端 wipe 有双重 confirm。

## 13. 服务器日志是否泄露 request body？—— 通过

- 检查方法：grep 全项目 `console.log/error/warn/debug`。
- 结论：`app/`、`lib/`、`components/` 零 console 输出；`scripts/generate-icons.js` 仅有文件名日志（`icon-${size}.png generated`），无请求体/密钥。API 路由从不打印请求体/密文/密钥。`lib/server/db/index.ts` 的 postgres 客户端未配置 debug（默认不打印查询）。

## 14. 第三方脚本是否能够读取日记？—— 通过

- 检查方法：grep `script src`/外链 URL，阅读 `app/layout.tsx` 与 `components/`。
- 结论：零第三方脚本、零外链（无 analytics/CDN/广告）。唯一脚本是本项目自己的 Service Worker 注册与 Next 构建产物。CSP 生产仅 `'self'`，第三方脚本即便被注入也无法加载。

## 15. 数据库泄露后攻击者是否能直接看到正文？—— 通过（密文不可读）

- 检查方法：结合第 1 项 schema 与加密实现 `lib/client/crypto/encryption.ts`。
- 结论：正文为 AES-256-GCM 密文，DEK 只在用户浏览器内存；攻击者即使拿到整个数据库，也仅有密文 + 无密钥材料（wrapper 密文同样需要 KEK，KEK 来自 Passkey PRF 输出或 Recovery Key，均不在服务器）。无法恢复明文。
- 说明：经纬度/时间戳等元数据不在加密范围内（设计如此，规格已明示），泄露可暴露位置轨迹，但不暴露正文。

---

## 附：本次 Task 13 新增的加固项

- `proxy.ts`（Next 16 的 middleware）：所有页面响应附加 CSP（生产严格）/X-Content-Type-Options/Referrer-Policy/X-Frame-Options/Permissions-Policy；粗粒度路由保护（未登录访问 `/`、`/history`、`/entry/*`、`/settings/*` 重定向 `/login`；已登录访问 `/login`、`/setup` 重定向 `/`）。
- `app/api/admin/wipe/route.ts`：认证 + 限流 + 清空全部表 + 清除会话 cookie。
- `app/api/keys/wrappers/recovery/route.ts`：PUT 更新 recovery wrapper（需认证，先经客户端旧密钥验证）。
- `app/settings/passkey/`：新 Passkey 复用服务器 `prfEval`（S 不变量），不生成新 S。
- 日志控制：确认零 console 输出（含此前已存在的代码）。
