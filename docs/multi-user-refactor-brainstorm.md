# 多用户改造头脑风暴

> **日期**：2026-08-27
> **状态**：本文件留存完整分析，供将来重启该话题时直接引用。
> **当前架构**：单用户、端到端加密私人日记 PWA（Passkey/Face ID + PRF 派生 DEK + Recovery Key 兜底）

---

## 结论先行：加密可信性（多用户不弱化）

当前密码学模型**不因多用户而变弱**，前提是隔离做对：

| 层 | 现状（单用户） | 多用户后 | 可信依据 |
|---|---|---|---|
| DEK | 全站一把 | **每用户一把**（各自生成） | 服务器只见密文 |
| PRF eval 输入 S | 全站共享一个 | **每用户一个** | 各用户独立密钥链 |
| Recovery Key | 一个 hash | 每用户一个 hash | 服务器只有 SHA-256 |

加密强度（AES-256-GCM + HKDF + WebAuthn PRF）全部不变——每用户多一把独立 DEK，隔离反而更彻底。

---

## 1. 数据模型层

- 新增 `users` 表（id、username 唯一、created_at）——注册时的用户名即账号标识
- 所有业务表加 `user_id`：
  - `credentials.user_id`
  - `key_wrappers.user_id`——**recovery wrapper 的「全局唯一」约束必须改为「(user_id, wrapper_type) 唯一」**（索引级改造）
  - `diary_entries.user_id`（索引改为 `(user_id, created_at)`）
  - `drafts.user_id`
- 注册保护 `already_initialized`（凭证非空禁止注册）逻辑删除——多用户要允许任意注册

## 2. 认证与会话层

- 注册流程：新用户注册 → 生成自己的 DEK + S → 注册通行密钥（Face ID）→ 展示恢复密钥 → 完成
- session JWT：`sub` 从固定 `'owner'` 改为真实 user_id（`getSessionCredential` 已有同款机制可复用）
- `requireAuth` 升级为返回当前 user_id
- **多账号同设备天然可行**：同一台 iPhone 的 iCloud 钥匙串里有 A、B 两把 passkey，登录弹窗自动列出、选中即登录对应账号（`assertion.id → credential.user_id`）——无需账号切换 UI（即现有「会话绑定凭证」机制的延伸）

## 3. API 隔离清单（逐接口）

约 15 个路由全部加 `WHERE user_id = 会话用户`：

- diary 增删改查、stats、draft
- keys/wrappers（POST 校验 credential 归属当前用户）
- keys/passkeys 列表/禁用/启用
- login/options（prfEval 按用户取，见「关键坑」）
- recovery-login（hash 匹配限定用户）
- admin/wipe（只删本人）
- register（新用户创建 users 行 + credential）

## 4. 前端 / UX

- 登录页：主按钮「使用通行密钥登录」居中 + 底部淡化小字「注册新账号」
- 新注册流程页（改造现有 setup 页，复用大部分逻辑）：用户名 → 通行密钥 → 恢复密钥 → 完成

## 5. 关键坑（比表面需求更重要）

1. **`login/options` 的 prfEval 必须按用户取**——现在取「第一个 wrapper 的 salt」（全局）。多用户后 A 登录若拿到 B 的 S：解包必失败（不泄密，但 A 永久无法解锁 = 功能性 DoS）。**这是全项目最需要改对的一行。**
2. **开放注册 = 信任模型剧变**：服务器从「只服务一人」变为公开目标。强烈建议加**邀请码**（服务端配置，仅知情人可注册）。
3. **现有数据迁移**：owner 数据插入 users 行，全部存量行回填 user_id，再重建唯一约束——一次 migration 搞定。
4. **wipe 已是「只删本人」的雏形**：现 `admin/wipe` 清全库（单用户成立）；多用户后按 user_id 删（工作量最小）。

## 6. 工作量评估

| 阶段 | 内容 | 量级 |
|---|---|---|
| ① 数据层 | users 表 + 4 张表加列 + 回填 + 约束重建 | 1 张 migration |
| ② 服务端 | 15 个路由加 user_id 过滤 + 注册接口 + session 改造 + prfEval 按用户 | 核心工作量 |
| ③ 前端 | 登录页双入口 + 注册流程页 | 中等 |
| ④ 测试 | API 隔离回归测试 | 小 |

**总估**：半天到一天（对当前单人代码库）。风险最高的在 ② 的 prfEval 隔离和 wrapper 归属校验，其余为机械性过滤。

## 7. 建议

- 目标是「给信任的几个人用」→ 值得做（邀请码 + 隔离）
- 目标是「公开注册」→ 先想清楚运维成本（存储、滥用、客服）
- 若实施：从 ①② 开始，前端最后接
