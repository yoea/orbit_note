# Quiet Orbit 私人日记 PWA 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从零构建单用户 E2EE 私人日记 PWA（iPhone Safari/PWA + Windows Edge 调试），Passkey/Face ID 认证，正文 AES-256-GCM 客户端加密，服务器只见密文。

**Architecture:** Next.js App Router + Drizzle/PostgreSQL + WebAuthn（@simplewebauthn）+ WebAuthn PRF 派生 KEK 保护 DEK，Recovery Key 降级/灾难恢复。key_wrappers 多行表支持多 Passkey。客户端 IndexedDB 存加密草稿，Service Worker 仅缓存静态资源。

**Tech Stack:** Next.js(最新稳定版), TypeScript strict, Tailwind CSS v4, Drizzle ORM + postgres.js, @simplewebauthn/server+browser, jose, zod, vitest。

**规格:** `docs/superpowers/specs/2026-08-25-quiet-orbit-design.md`

**开发环境:** Windows 11, 本机 PostgreSQL :5432 (postgres/凭据在 .env), Edge 调试。生产目标: iOS 26 Safari。

---

## 跨任务契约（实现时必须保持一致）

### 密钥层级（代码注释必须说明）

```
DEK ── 256-bit 随机，首次初始化生成，仅存浏览器内存
├─ Passkey PRF 输出 PRF(S) ──HKDF-SHA-256(ikm=PRF(S), salt=S)──▶ Passkey KEK ──AES-256-GCM──▶ wrapper_p
└─ Recovery Key(32B) ──HKDF-SHA-256(ikm=RecoveryKey, salt=salt_r)──▶ Recovery KEK ──▶ wrapper_r
```

**关键 PRF 细节**：注册时 `prf.eval.first = S`（32 随机字节）；注册后立即做一次认证拿到 `PRF(S)` 才能构造 wrapper_p。每次登录用**同一个 S** 做 `prf.eval.first` → 得到相同 `PRF(S)`。S 即 wrapper_p 的 HKDF salt（salt 不需保密）。wrapper_r 用独立随机 salt_r。

### 模块签名

| 模块 | 导出 |
|---|---|
| `lib/server/env.ts` | `env: {DATABASE_URL, WEBAUTHN_RP_ID, WEBAUTHN_RP_NAME, WEBAUTHN_ORIGIN, SESSION_SECRET, RECOVERY_KEY_VERSION, NODE_ENV}` |
| `lib/server/session.ts` | `SESSION_COOKIE`, `createSession(): Promise<string>`, `verifySessionToken(token): Promise<boolean>` |
| `lib/server/ratelimit.ts` | `rateLimit(key: string, max: number, windowMs: number): boolean` |
| `lib/server/validation.ts` | `diaryCreateSchema, diaryUpdateSchema, draftPutSchema, wrapperSchema`（zod） |
| `lib/server/webauthn.ts` | `generateRegisterOptions()`, `verifyRegistration(resp, expectedChallenge)`, `generateLoginOptions(allowCredentials)`, `verifyLogin(assertion, expectedChallenge, credential)` |
| `lib/server/db/schema.ts` | `credentials, keyWrappers, diaryEntries, drafts` 表 |
| `lib/server/db/index.ts` | `db` (drizzle(postgres(env.DATABASE_URL))) |
| `lib/client/crypto/base64.ts` | `toBase64(bytes): string`, `fromBase64(s): Uint8Array` |
| `lib/client/crypto/kdf.ts` | `deriveKek(ikm: Uint8Array, salt: Uint8Array, info: string): Promise<CryptoKey>` |
| `lib/client/crypto/encryption.ts` | `generateDek()`, `randomBytes(n)`, `encryptText(key, text)`, `decryptText(key, ct, iv)`, `wrapDek(dek, kek)`, `unwrapDek(kek, encryptedDek, iv)` |
| `lib/client/crypto/recovery-key.ts` | `generateRecoveryKey(): string`(base64url 43 字符), `decodeRecoveryKey(key): Uint8Array` |
| `lib/client/webauthn.ts` | `registerPasskey(optionsJSON)`, `authenticatePasskey(optionsJSON, prfEval)`, `extractPrfResult(credential)` |
| `lib/client/idb.ts` | `idbGet(key)`, `idbSet(key, val)`, `idbDelete(key)`, `idbClearAll()` |
| `lib/client/draft-sync.ts` | `pickNewer(local, server)`, `localDraftSave()`, `serverDraftSave()`, `clearDrafts()` |
| `lib/client/location.ts` | `getPosition(timeoutMs): Promise<{latitude, longitude, accuracy} | null>` |
| `lib/client/session.ts` | `fetchSession()`, `fetchWrappers()`, `loginWithPasskey()`, `unlockWithRecoveryKey(key)`, `getDek()`, `clearDek()` |

### 认证/加密关键规则

1. 服务器**生成**所有 `id / createdAt / updatedAt`；客户端传这些字段一律 zod 拒绝（strict object）。
2. challenge 存内存 Map（token→{challenge, type, expiresAt}，TTL 60s），`challengeMap` 导出自 `lib/server/webauthn.ts`。
3. counter 回滚防护：`credential.counter > 0 && newCounter <= credential.counter` → 拒绝。
4. 已存在任意 credential 时 `/api/auth/register` 返回 403。
5. 所有非公开 API 无 session → 401；diary/draft/keys API 均需要认证。
6. 日志禁止输出 body/密文/密钥。

---

### Task 1: Phase 1 — 脚手架与基线

**Files:**
- Create: 整个项目（create-next-app 生成）
- Create: `vitest.config.ts`, `tsconfig.json` 追加 strict 校验, `lib/server/env.ts`
- Test: `tests/crypto/base64.test.ts`（第一份测试，验证 vitest 链路）

- [ ] **Step 1: 生成 Next.js 项目**

```bash
cd /d/Develope/project/quiet_orbit
npx create-next-app@latest . --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --turbopack --yes
```

Expected: 项目生成到当前目录，`package.json` 存在。若提示冲突（目录非空，已有 docs/ 与 thisismyneed.md），create-next-app 会问是否覆盖——选否，改为在确认生成的文件基础上保留 docs 与 thisismyneed.md（create-next-app 只写入自身模板文件，不会删除 docs/）。

- [ ] **Step 2: 安装依赖**

```bash
npm install drizzle-orm postgres @simplewebauthn/server @simplewebauthn/browser jose zod
npm install -D drizzle-kit vitest @types/node
```

Expected: 安装成功，无 peer 冲突。

- [ ] **Step 3: 配置 vitest + TypeScript strict**

创建 `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
```

`package.json` scripts 增加:

```json
"typecheck": "tsc --noEmit",
"test": "vitest run",
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
```

确认 `tsconfig.json` 有 `"strict": true`（create-next-app 默认）。若无则加入。

- [ ] **Step 4: 写第一份测试（验证 vitest + WebCrypto 链路）**

创建 `tests/crypto/base64.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { toBase64, fromBase64 } from '../../lib/client/crypto/base64'

describe('base64', () => {
  it('roundtrip', () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255])
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
  })
  it('handles empty', () => {
    expect(toBase64(new Uint8Array(0))).toBe('')
    expect(fromBase64('')).toEqual(new Uint8Array(0))
  })
})
```

- [ ] **Step 5: 创建 base64 模块（先建 `lib/client/crypto/base64.ts`）**

```ts
// 浏览器/Node 通用的 base64 <-> Uint8Array 工具
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function fromBase64(s: string): Uint8Array {
  const binary = atob(s)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
```

- [ ] **Step 6: 运行测试与基线检查**

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Expected: 4 个命令全部成功。build 生成的 `.next` 无需提交。

- [ ] **Step 7: 创建 .gitignore 条目并提交**

`.gitignore` 追加（若 create-next-app 未包含）:

```
.env
.env.local
*.pem
```

```bash
git add -A
git commit -m "chore: Next.js 脚手架 + vitest + 依赖基线
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Phase 2 — 数据库 Schema 与 Migration

**Files:**
- Create: `drizzle.config.ts`, `lib/server/db/schema.ts`, `lib/server/db/index.ts`, `lib/server/env.ts`
- Create: `drizzle/migrations/`（drizzle-kit 生成）

- [ ] **Step 1: 创建环境变量模块**

创建 `.env.local`（开发）与 `.env.example`:

```
DATABASE_URL=postgres://postgres:yMrQSFsXytEMMZyFhaZY@localhost:5432/quiet_orbit
WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_NAME=我的日记
WEBAUTHN_ORIGIN=http://localhost:3000
SESSION_SECRET=<用下面命令生成>
RECOVERY_KEY_VERSION=1
```

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

把输出填入 SESSION_SECRET（.env.local 与 .env.example 中放占位说明，.env.example 不含真实密码）。

创建 `lib/server/env.ts`:

```ts
import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  WEBAUTHN_RP_ID: z.string().min(1),
  WEBAUTHN_RP_NAME: z.string().min(1),
  WEBAUTHN_ORIGIN: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  RECOVERY_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

export const env = envSchema.parse(process.env)
```

- [ ] **Step 2: 创建 Drizzle 配置**

`drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit'
import { env } from './lib/server/env'

export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: env.DATABASE_URL },
})
```

注意：drizzle.config.ts 会被 Node 直接加载，`lib/server/env.ts` 的 zod parse 若失败会立即报错——确保 `.env.local` 中 SESSION_SECRET 已填。若加载顺序问题，将 `.env.local` 内容复制到 `.env` 也可（dotenv 自动加载）。

- [ ] **Step 3: 创建数据库 Schema**

`lib/server/db/schema.ts`（4 张表，见规格第 5 节）:

```ts
import {
  bigint, doublePrecision, integer, jsonb, pgTable, text, timestamp, uuid,
} from 'drizzle-orm/pg-core'

export const credentials = pgTable('credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: text('public_key').notNull(),
  counter: bigint('counter', { mode: 'number' }).notNull().default(0),
  transports: jsonb('transports').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
})

// 密钥包装表：每个 credential 一个 PRF wrapper + 一个 recovery wrapper（多行）
export const keyWrappers = pgTable('key_wrappers', {
  id: uuid('id').primaryKey().defaultRandom(),
  wrapperType: text('wrapper_type').notNull(), // 'passkey_prf' | 'recovery'
  credentialId: text('credential_id'), // passkey_prf 时有值；recovery 为 null
  encryptedDek: text('encrypted_dek').notNull(),
  salt: text('salt').notNull(), // passkey_prf: PRF eval 输入 S；recovery: 随机 salt_r
  encryptionVersion: integer('encryption_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const diaryEntries = pgTable('diary_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  encryptionVersion: integer('encryption_version').notNull().default(1),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  locationAccuracy: doublePrecision('location_accuracy'),
  timezone: text('timezone'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// 单行草稿（单用户）
export const drafts = pgTable('drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  encryptionVersion: integer('encryption_version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

创建 `lib/server/db/index.ts`:

```ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env'
import * as schema from './schema'

const client = postgres(env.DATABASE_URL, { max: 5 })
export const db = drizzle(client, { schema })
export type DB = typeof db
```

- [ ] **Step 4: 建库 + 生成并应用 migration**

```bash
node -e "const{Client}=require('pg');const c=new Client({connectionString:'postgres://postgres:yMrQSFsXytEMMZyFhaZY@localhost:5432/postgres'});c.connect().then(()=>c.query('CREATE DATABASE quiet_orbit').then(()=>{console.log('created');process.exit(0)})).catch(e=>{if(e.code==='42P04'){console.log('exists');process.exit(0)};console.error(e);process.exit(1)})"
npm run db:generate
npm run db:migrate
```

Expected: 数据库 `quiet_orbit` 创建成功（或已存在）；drizzle 生成 SQL migration；migrate 输出 `4 tables` 之类成功信息。

- [ ] **Step 5: 验证 + 提交**

```bash
npm run typecheck && npm run build
git add -A
git commit -m "feat: Drizzle schema（credentials/key_wrappers/diary_entries/drafts）+ migration
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Phase 3a — 服务端基础模块（session / ratelimit / validation / webauthn）

**Files:**
- Create: `lib/server/session.ts`, `lib/server/ratelimit.ts`, `lib/server/validation.ts`, `lib/server/webauthn.ts`

- [ ] **Step 1: Session 模块**

`lib/server/session.ts`:

```ts
import { SignJWT, jwtVerify } from 'jose'
import { env } from './env'

const secret = new TextEncoder().encode(env.SESSION_SECRET)
export const SESSION_COOKIE = 'qo_session'

export async function createSession(): Promise<string> {
  return new SignJWT({ sub: 'owner' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret)
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secret)
    return payload.sub === 'owner'
  } catch {
    return false
  }
}
```

- [ ] **Step 2: Rate limit 模块**

`lib/server/ratelimit.ts`:

```ts
// 单用户系统的内存滑动窗口限流。生产单实例即可；如多实例需换共享存储。
const windows = new Map<string, number[]>()

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const arr = (windows.get(key) ?? []).filter((t) => now - t < windowMs)
  if (arr.length >= max) {
    windows.set(key, arr)
    return false
  }
  arr.push(now)
  windows.set(key, arr)
  return true
}
```

- [ ] **Step 3: 校验模块（zod）**

`lib/server/validation.ts`:

```ts
import { z } from 'zod'

const locationFields = {
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  locationAccuracy: z.number().min(0).max(10_000).nullable().optional(),
}

const encryptedPayload = {
  ciphertext: z.string().min(1).max(300_000),
  iv: z.string().min(1).max(64),
  encryptionVersion: z.number().int().min(1).max(10).default(1),
}

// 明确拒绝客户端传 id/created_at/updated_at（strict 模式会拒绝未知键）
export const diaryCreateSchema = z
  .strictObject({ ...encryptedPayload, timezone: z.string().max(64).nullable().optional(), ...locationFields })
export const diaryUpdateSchema = z
  .strictObject({
    ciphertext: z.string().min(1).max(300_000).optional(),
    iv: z.string().min(1).max(64).optional(),
    encryptionVersion: z.number().int().min(1).max(10).optional(),
    timezone: z.string().max(64).nullable().optional(),
    ...locationFields,
  })
export const draftPutSchema = z.strictObject({ ...encryptedPayload, timezone: z.string().max(64).nullable().optional() })
export const wrapperSchema = z.strictObject({
  wrapperType: z.literal('passkey_prf'),
  credentialId: z.string().min(1).max(512),
  encryptedDek: z.string().min(1).max(2048),
  salt: z.string().min(1).max(256),
  encryptionVersion: z.number().int().min(1).max(10).default(1),
})
```

- [ ] **Step 4: WebAuthn 服务端模块**

`lib/server/webauthn.ts`:

```ts
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { env } from './env'

export const rpID = env.WEBAUTHN_RP_ID
export const rpName = env.WEBAUTHN_RP_NAME
export const origin = env.WEBAUTHN_ORIGIN

// challenge 内存存储：token -> {challenge, type, expiresAt}（TTL 60s，单用户足够）
export const challengeMap = new Map<string, { challenge: string; type: 'register' | 'login'; expiresAt: number }>()

export function storeChallenge(type: 'register' | 'login'): { token: string; challenge: string } {
  const challenge = crypto.randomUUID() + crypto.randomUUID()
  const token = crypto.randomUUID()
  challengeMap.set(token, { challenge, type, expiresAt: Date.now() + 60_000 })
  return { token, challenge }
}

export function takeChallenge(token: string, type: 'register' | 'login'): string | null {
  const entry = challengeMap.get(token)
  if (!entry || entry.type !== type || entry.expiresAt < Date.now()) return null
  challengeMap.delete(token)
  return entry.challenge
}

export async function generateRegisterOptions() {
  return generateRegistrationOptions({
    rpName,
    rpID,
    userName: 'owner',
    userDisplayName: 'Owner',
    userID: new TextEncoder().encode('quiet-orbit-owner'),
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
      authenticatorAttachment: 'platform',
    },
    supportedAlgorithmIDs: [-7, -257],
    timeout: 60_000,
  })
}

export async function verifyRegistration(registration: unknown, expectedChallenge: string) {
  return verifyRegistrationResponse({
    response: registration,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  })
}

export async function generateLoginOptions(allowCredentials: { id: string; transports: string[] }[]) {
  return generateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: 'required',
    timeout: 60_000,
  })
}

export async function verifyLogin(
  assertion: unknown,
  expectedChallenge: string,
  credential: { id: string; publicKey: string; counter: number; transports: string[] },
) {
  return verifyAuthenticationResponse({
    response: assertion,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential,
  })
}
```

- [ ] **Step 5: 检查 + 提交**

```bash
npm run typecheck && npm run lint
git add -A
git commit -m "feat: 服务端基础模块（session/ratelimit/validation/webauthn）
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Phase 3b — Auth API Routes（register/login/logout/session）

**Files:**
- Create: `app/api/auth/register/options/route.ts`, `app/api/auth/register/route.ts`
- Create: `app/api/auth/login/options/route.ts`, `app/api/auth/login/route.ts`
- Create: `app/api/auth/logout/route.ts`, `app/api/auth/session/route.ts`

- [ ] **Step 1: 注册选项 API**

`app/api/auth/register/options/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { credentials } from '@/lib/server/db/schema'
import { rateLimit } from '@/lib/server/ratelimit'
import { generateRegisterOptions, storeChallenge } from '@/lib/server/webauthn'

export async function GET(req: Request) {
  if (!rateLimit('register-options', 5, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const existing = await db.select().from(credentials).limit(1)
  // 已初始化：注册仅允许已登录用户在设置页添加新 Passkey
  const authenticated = req.headers.get('cookie')?.includes('qo_session=') ?? false
  if (existing.length > 0 && !authenticated) {
    return NextResponse.json({ error: 'already_initialized' }, { status: 403 })
  }
  const { token, challenge } = storeChallenge('register')
  const options = await generateRegisterOptions()
  // @simplewebauthn/server 生成的 options 已带 challenge 字段，替换为我们存储的 challenge
  return NextResponse.json({ token, options: { ...options, challenge } })
}
```

注：`generateRegistrationOptions` 自行生成了 challenge，这里用 `storeChallenge` 的 challenge 覆盖，保证服务器存储的与返回的一致（验证时从 Map 取）。

- [ ] **Step 2: 注册验证 API**

`app/api/auth/register/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { credentials } from '@/lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { createSession } from '@/lib/server/session'
import { takeChallenge, verifyRegistration } from '@/lib/server/webauthn'
import { rateLimit } from '@/lib/server/ratelimit'

export async function POST(req: Request) {
  if (!rateLimit('register', 5, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const body = (await req.json().catch(() => null)) as {
    token?: string
    registration?: unknown
  } | null
  if (!body?.token || !body.registration) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const existing = await db.select().from(credentials).limit(1)
  if (existing.length > 0 && !(req.headers.get('cookie')?.includes('qo_session=') ?? false)) {
    return NextResponse.json({ error: 'already_initialized' }, { status: 403 })
  }

  const expectedChallenge = takeChallenge(body.token, 'register')
  if (!expectedChallenge) return NextResponse.json({ error: 'challenge_expired' }, { status: 400 })

  const verification = await verifyRegistration(body.registration, expectedChallenge).catch(() => null)
  if (!verification?.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: 'verification_failed' }, { status: 400 })
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo
  const base64url = (b: Uint8Array) => Buffer.from(b).toString('base64url')
  await db.insert(credentials).values({
    credentialId: base64url(credential.id),
    publicKey: base64url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
  }).onConflictDoNothing()

  const session = await createSession()
  const res = NextResponse.json({ ok: true })
  res.cookies.set('qo_session', session, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 })
  return res
}
```

- [ ] **Step 3: 登录选项 API**

`app/api/auth/login/options/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { credentials } from '@/lib/server/db/schema'
import { rateLimit } from '@/lib/server/ratelimit'
import { generateLoginOptions, storeChallenge } from '@/lib/server/webauthn'

export async function GET() {
  if (!rateLimit('login-options', 10, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const all = await db.select().from(credentials)
  const allowCredentials = all.map((c) => ({
    id: Buffer.from(c.credentialId, 'base64url'),
    transports: c.transports,
  }))
  const { token, challenge } = storeChallenge('login')
  const options = await generateLoginOptions(allowCredentials)
  return NextResponse.json({ token, options: { ...options, challenge } })
}
```

- [ ] **Step 4: 登录验证 API（含 counter 回滚防护）**

`app/api/auth/login/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { credentials } from '@/lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { createSession } from '@/lib/server/session'
import { takeChallenge, verifyLogin } from '@/lib/server/webauthn'
import { rateLimit } from '@/lib/server/ratelimit'

export async function POST(req: Request) {
  if (!rateLimit('login', 10, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const body = (await req.json().catch(() => null)) as { token?: string; assertion?: unknown } | null
  if (!body?.token || !body.assertion) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const expectedChallenge = takeChallenge(body.token, 'login')
  if (!expectedChallenge) return NextResponse.json({ error: 'challenge_expired' }, { status: 400 })

  const assertion = body.assertion as { id?: string }
  const credentialId = assertion.id ? Buffer.from(assertion.id, 'base64url').toString('base64url') : null
  const [stored] = credentialId ? await db.select().from(credentials).where(eq(credentials.credentialId, credentialId)) : []
  if (!stored) return NextResponse.json({ error: 'unknown_credential' }, { status: 400 })

  const verification = await verifyLogin(body.assertion, expectedChallenge, {
    id: stored.credentialId,
    publicKey: stored.publicKey,
    counter: stored.counter,
    transports: stored.transports,
  }).catch(() => null)

  if (!verification?.verified) return NextResponse.json({ error: 'verification_failed' }, { status: 400 })

  // counter 回滚防护
  const newCounter = verification.authenticationInfo.newCounter
  if (stored.counter > 0 && newCounter <= stored.counter) {
    return NextResponse.json({ error: 'counter_replay_detected' }, { status: 400 })
  }
  await db.update(credentials).set({ counter: newCounter, lastUsedAt: new Date() }).where(eq(credentials.credentialId, stored.credentialId))

  const session = await createSession()
  const res = NextResponse.json({ ok: true })
  res.cookies.set('qo_session', session, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 })
  return res
}
```

- [ ] **Step 5: 登出 + 会话状态 API**

`app/api/auth/logout/route.ts`:

```ts
import { NextResponse } from 'next/server'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('qo_session', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
```

`app/api/auth/session/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { credentials, keyWrappers } from '@/lib/server/db/schema'
import { verifySessionToken } from '@/lib/server/session'

export async function GET(req: Request) {
  const cookie = req.headers.get('cookie') ?? ''
  const token = cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith('qo_session='))?.split('=')[1]
  const authenticated = token ? await verifySessionToken(decodeURIComponent(token)) : false

  const credentialCount = await db.select().from(credentials)
  const wrappers = await db.select().from(keyWrappers)
  return NextResponse.json({
    initialized: credentialCount.length > 0,
    authenticated,
    credentialCount: credentialCount.length,
    hasRecoveryWrapper: wrappers.some((w) => w.wrapperType === 'recovery'),
    prfWrappers: wrappers.filter((w) => w.wrapperType === 'passkey_prf').length,
  })
}
```

- [ ] **Step 6: 检查 + 提交**

```bash
npm run typecheck && npm run lint && npm run build
git add -A
git commit -m "feat: WebAuthn auth API（register/login/logout/session + counter 防护）
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Phase 4a — 客户端 Crypto 模块（TDD）

**Files:**
- Create: `lib/client/crypto/kdf.ts`, `lib/client/crypto/encryption.ts`, `lib/client/crypto/recovery-key.ts`
- Test: `tests/crypto/kdf.test.ts`, `tests/crypto/encryption.test.ts`, `tests/crypto/recovery-key.test.ts`

- [ ] **Step 1: 写 kdf 测试（先失败）**

`tests/crypto/kdf.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { deriveKek } from '../../lib/client/crypto/kdf'

describe('deriveKek (HKDF-SHA-256)', () => {
  it('derives a 256-bit AES key', async () => {
    const ikm = new Uint8Array(32).fill(7)
    const salt = new Uint8Array(16).fill(3)
    const key = await deriveKek(ikm, salt, 'passkey-kek')
    expect(key.algorithm.name).toBe('AES-GCM')
    expect(key.usages).toContain('encrypt')
  })
  it('different salt -> different key', async () => {
    const ikm = new Uint8Array(32).fill(7)
    const k1 = await deriveKek(ikm, new Uint8Array(16).fill(1), 'passkey-kek')
    const k2 = await deriveKek(ikm, new Uint8Array(16).fill(2), 'passkey-kek')
    expect(k1).not.toEqual(k2)
  })
  it('same inputs -> same key', async () => {
    const ikm = new Uint8Array(32).fill(7)
    const salt = new Uint8Array(16).fill(3)
    const k1 = await deriveKek(ikm, salt, 'passkey-kek')
    const k2 = await deriveKek(ikm, salt, 'passkey-kek')
    expect(k1).toEqual(k2)
  })
})
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/crypto/kdf.test.ts
```

Expected: FAIL — `Cannot find module '../../lib/client/crypto/kdf'`

- [ ] **Step 3: 实现 kdf**

`lib/client/crypto/kdf.ts`:

```ts
// 密钥派生：所有 KEK 均通过 HKDF-SHA-256 派生（规格第八节）
export async function deriveKek(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(info) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run tests/crypto/kdf.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: 写 encryption 测试（先失败）**

`tests/crypto/encryption.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decryptText, encryptText, generateDek, unwrapDek, wrapDek, randomBytes } from '../../lib/client/crypto/encryption'

describe('AES-256-GCM 日记加密', () => {
  it('encrypt/decrypt roundtrip 中文+emoji+换行', async () => {
    const dek = await generateDek()
    const text = '今天晚上突然想写点东西……\n😀 ❤️ 🥹\n第二行'
    const { ciphertext, iv } = await encryptText(dek, text)
    expect(ciphertext).not.toContain('东西')
    expect(await decryptText(dek, ciphertext, iv)).toBe(text)
  })
  it('每篇日记 IV 唯一', async () => {
    const dek = await generateDek()
    const a = await encryptText(dek, 'hello')
    const b = await encryptText(dek, 'hello')
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })
  it('篡改 ciphertext 必须解密失败', async () => {
    const dek = await generateDek()
    const { ciphertext, iv } = await encryptText(dek, 'secret text')
    const bytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0))
    bytes[0] ^= 0xff
    const tampered = btoa(String.fromCharCode(...bytes))
    await expect(decryptText(dek, tampered, iv)).rejects.toThrow()
  })
  it('篡改 IV 必须解密失败', async () => {
    const dek = await generateDek()
    const { ciphertext, iv } = await encryptText(dek, 'secret text')
    const bytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0))
    bytes[0] ^= 0x01
    const tamperedIv = btoa(String.fromCharCode(...bytes))
    await expect(decryptText(dek, ciphertext, tamperedIv)).rejects.toThrow()
  })
  it('错误 key 必须解密失败', async () => {
    const dek = await generateDek()
    const other = await generateDek()
    const { ciphertext, iv } = await encryptText(dek, 'secret')
    await expect(decryptText(other, ciphertext, iv)).rejects.toThrow()
  })
  it('wrap/unwrap DEK roundtrip', async () => {
    const dek = await generateDek()
    const kek = await generateDek() // 仅测试用途：KEK 同算法结构
    const { encryptedDek, iv } = await wrapDek(dek, kek)
    const unwrapped = await unwrapDek(kek, encryptedDek, iv)
    const { ciphertext, iv: iv2 } = await encryptText(dek, 'via-unwrapped')
    const check = await encryptText(unwrapped, 'via-unwrapped')
    expect(await decryptText(unwrapped, ciphertext, iv2)).toBe('via-unwrapped')
    expect(check.iv).toBeDefined()
  })
  it('randomBytes 生成 96-bit IV 长度', () => {
    expect(randomBytes(12).length).toBe(12)
  })
})
```

- [ ] **Step 6: 实现 encryption（复用 base64 工具）**

`lib/client/crypto/encryption.ts`:

```ts
import { fromBase64, toBase64 } from './base64'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

export async function generateDek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

// 正文加密：每篇唯一 96-bit IV，密文 base64 存储
export async function encryptText(
  key: CryptoKey,
  plaintext: string,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = randomBytes(12)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext))
  return { ciphertext: toBase64(new Uint8Array(cipher)), iv: toBase64(iv) }
}

export async function decryptText(key: CryptoKey, ciphertext: string, iv: string): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(ciphertext))
  return decoder.decode(plain)
}

// 用 KEK 包裹 DEK（export raw 后 AES-GCM 加密）
export async function wrapDek(
  dek: CryptoKey,
  kek: CryptoKey,
): Promise<{ encryptedDek: string; iv: string }> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dek))
  const iv = randomBytes(12)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw)
  return { encryptedDek: toBase64(new Uint8Array(cipher)), iv: toBase64(iv) }
}

export async function unwrapDek(kek: CryptoKey, encryptedDek: string, iv: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, kek, fromBase64(encryptedDek))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
```

注意：wrapper 的 iv 需随 wrapper 一起持久化——schema 中 `keyWrappers` 表没有 iv 列，解决方案：`encryptedDek` 字段存 `base64(iv + cipher)`（拼接），unwrap 时前 12 字节为 IV。实现放 Task 7 的 wrapper 工具函数 `lib/client/crypto/wrapper.ts`。

- [ ] **Step 7: 实现 wrapper 编解码工具（含 IV 拼接约定）**

`lib/client/crypto/wrapper.ts`:

```ts
import { fromBase64, toBase64 } from './base64'
import { randomBytes } from './encryption'

// keyWrappers.encryptedDek 格式：base64(iv(12B) + ciphertext)，IV 内嵌避免额外列
export function encodeWrapped(encrypted: ArrayBuffer): string {
  const cipher = new Uint8Array(encrypted)
  const iv = randomBytes(12)
  const out = new Uint8Array(iv.length + cipher.length)
  out.set(iv, 0)
  out.set(cipher, iv.length)
  return toBase64(out)
}

export function decodeWrapped(s: string): { iv: Uint8Array; data: Uint8Array } {
  const all = fromBase64(s)
  return { iv: all.slice(0, 12), data: all.slice(12) }
}
```

修改 `tests/crypto/encryption.test.ts` 的 wrap/unwrap 用例改为通过 encodeWrapped/decodeWrapped 验证（更新该测试）。

- [ ] **Step 8: 写 recovery-key 测试（先失败）**

`tests/crypto/recovery-key.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decodeRecoveryKey, generateRecoveryKey } from '../../lib/client/crypto/recovery-key'

describe('Recovery Key', () => {
  it('生成 256-bit 熵（base64url 43 字符）', () => {
    const key = generateRecoveryKey()
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
  it('两次生成不同', () => {
    expect(generateRecoveryKey()).not.toBe(generateRecoveryKey())
  })
  it('decode 得到 32 字节', () => {
    const key = generateRecoveryKey()
    expect(decodeRecoveryKey(key).length).toBe(32)
  })
  it('拒绝非法字符/长度', () => {
    expect(() => decodeRecoveryKey('bad key!')).toThrow()
    expect(() => decodeRecoveryKey('a')).toThrow()
  })
})
```

- [ ] **Step 9: 实现 recovery-key**

`lib/client/crypto/recovery-key.ts`:

```ts
import { randomBytes } from './encryption'
import { fromBase64, toBase64 } from './base64'

// 32 字节 CSPRNG → base64url（43 字符，无 padding），显示一次
export function generateRecoveryKey(): string {
  return encodeRecoveryKey(randomBytes(32))
}

export function encodeRecoveryKey(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeRecoveryKey(key: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('无效的恢复密钥格式')
  const b64 = key.replace(/-/g, '+').replace(/_/g, '/') + '=='
  return fromBase64(b64)
}

// 服务器端 recovery-login 校验用哈希（recovery key 256-bit 熵，SHA-256 不可逆且不可爆破）
export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
```

- [ ] **Step 10: 全量测试 + 检查 + 提交**

```bash
npm test
npm run typecheck && npm run lint
git add -A
git commit -m "feat: 客户端 E2EE crypto 模块（HKDF/AES-256-GCM/Recovery Key）+ TDD 测试
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Phase 4b — Wrappers API 与初始化密钥流程

**Files:**
- Create: `app/api/keys/wrappers/route.ts`
- Create: `lib/client/webauthn.ts`, `lib/client/crypto/setup.ts`
- Test: `tests/crypto/setup.test.ts`

- [ ] **Step 1: Wrappers API**

`app/api/keys/wrappers/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { credentials, keyWrappers } from '@/lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { verifySessionToken } from '@/lib/server/session'
import { wrapperSchema } from '@/lib/server/validation'

async function authed(req: Request): Promise<boolean> {
  const cookie = req.headers.get('cookie') ?? ''
  const token = cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith('qo_session='))?.split('=')[1]
  return token ? verifySessionToken(decodeURIComponent(token)) : false
}

export async function GET(req: Request) {
  if (!(await authed(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const wrappers = await db.select().from(keyWrappers)
  return NextResponse.json({ wrappers })
}

export async function POST(req: Request) {
  if (!(await authed(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = wrapperSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'bad_request', details: body.error.issues }, { status: 400 })
  const { wrapperType, credentialId, encryptedDek, salt, encryptionVersion } = body.data
  // 仅允许包裹已注册的 credential
  const [cred] = await db.select().from(credentials).where(eq(credentials.credentialId, credentialId))
  if (!cred) return NextResponse.json({ error: 'unknown_credential' }, { status: 400 })
  await db.insert(keyWrappers).values({ wrapperType, credentialId, encryptedDek, salt, encryptionVersion })
  return NextResponse.json({ ok: true }, { status: 201 })
}
```

- [ ] **Step 2: PRF base64url 工具**

`lib/client/crypto/prf.ts`:

```ts
import { toBase64 } from './base64'

// PRF eval 输入 / 输出均以 base64url（无 padding）表示
export function prfEvalB64(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
```

- [ ] **Step 3: 客户端 WebAuthn 封装（PRF 核心）**

`lib/client/webauthn.ts`:

```ts
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { fromBase64, toBase64 } from './crypto/base64'
import type { RegistrationCredentialJSON, AuthenticationResponseJSON } from '@simplewebauthn/browser'

// PRF eval 输入 S：与服务器 keyWrappers.salt 一致（注册时决定，登录时从服务器获取）
export async function registerPasskey(
  options: Record<string, unknown>,
  prfEvalS: Uint8Array,
): Promise<{ registration: RegistrationCredentialJSON; prfEnabled: boolean }> {
  const optionsJSON = {
    ...options,
    extensions: { prf: { eval: { first: toBase64(prfEvalS).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') } } },
  }
  const registration = await startRegistration({ optionsJSON })
  const ext = registration.clientExtensionResults ?? {}
  return { registration, prfEnabled: Boolean((ext.prf as { enabled?: boolean } | undefined)?.enabled) }
}

export async function authenticatePasskey(
  options: Record<string, unknown>,
  prfEvalS: string | null,
): Promise<{ assertion: AuthenticationResponseJSON; prfResult: string | null }> {
  const optionsJSON = prfEvalS
    ? { ...options, extensions: { prf: { eval: { first: prfEvalS } } } }
    : options
  const assertion = await startAuthentication({ optionsJSON })
  const ext = assertion.clientExtensionResults ?? {}
  const prf = ext.prf as { results?: { first?: string } } | undefined
  return { assertion, prfResult: prf?.results?.first ?? null }
}
```

注意：`startRegistration`/`startAuthentication` 的 exact 参数形态以安装的 @simplewebauthn/browser 版本为准（v11+ 支持 `{ optionsJSON }`）。若类型报错，查看 `node_modules/@simplewebauthn/browser/dist/types/index.d.ts` 调整传参形态。

- [ ] **Step 3: 初始化密钥流程模块（先写测试）**

`tests/crypto/setup.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createWrappedDek, unwrapWithRecoveryKey } from '../../lib/client/crypto/setup'

describe('setup 密钥流程', () => {
  it('recovery wrapper 往返', async () => {
    const recoveryKey = 'a'.repeat(43) // 占位格式，实际由真实随机值生成
    const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const wrapped = await createWrappedDek(dek, new TextEncoder().encode(recoveryKey), 'recovery-kek')
    expect(wrapped.salt).toBeTruthy() // salt 自动生成（base64）
    const restored = await unwrapWithRecoveryKey(wrapped.encryptedDek, wrapped.salt, recoveryKey)
    // 用恢复出的 DEK 加解密验证
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, restored, new TextEncoder().encode('ok'))
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, dek, ct)
    expect(new TextDecoder().decode(pt)).toBe('ok')
  })
  it('错误 recovery key 必须失败', async () => {
    const recoveryKey = 'b'.repeat(43)
    const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const wrapped = await createWrappedDek(dek, new TextEncoder().encode(recoveryKey), 'recovery-kek')
    await expect(unwrapWithRecoveryKey(wrapped.encryptedDek, wrapped.salt, 'c'.repeat(43))).rejects.toThrow()
  })
})
```

- [ ] **Step 4: 实现 setup 模块（干净最终版）**

`lib/client/crypto/setup.ts`:

```ts
import { deriveKek } from './kdf'
import { decodeWrapped } from './wrapper'
import { decodeRecoveryKey } from './recovery-key'
import { randomBytes } from './encryption'
import { toBase64, fromBase64 } from './base64'

// 密钥层级（规格第七节，注释必须保留）：
// DEK(256-bit 随机，仅内存)
//  ├─ Passkey PRF 输出 PRF(S) ──HKDF(salt=S)──▶ Passkey KEK ──AES-256-GCM──▶ wrapper_p
//  └─ Recovery Key(32B) ──HKDF(salt=salt_r)──▶ Recovery KEK ──AES-256-GCM──▶ wrapper_r
// wrapper 的 encryptedDek 存储格式：base64( iv(12B) + ciphertext )，IV 内嵌

// 用 KEK 包裹 DEK（KEK 由调用方派生）
export async function wrapWithKek(dek: CryptoKey, kek: CryptoKey): Promise<{ encryptedDek: string; salt: string }> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dek))
  const iv = randomBytes(12)
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw))
  const combined = new Uint8Array(iv.length + cipher.length)
  combined.set(iv, 0)
  combined.set(cipher, iv.length)
  return { encryptedDek: toBase64(combined), salt: toBase64(randomBytes(16)) }
}

// Recovery Key 包裹 DEK：RecoveryKey → HKDF(salt) → KEK → AES-GCM(DEK)
// salt 可选传入（base64）；不传则自动生成随机 salt
export async function createWrappedDek(
  dek: CryptoKey,
  ikm: Uint8Array,
  info: string,
  saltB64?: string,
): Promise<{ encryptedDek: string; salt: string }> {
  const saltBytes = saltB64 ? fromBase64(saltB64) : randomBytes(16)
  const kek = await deriveKek(ikm, saltBytes, info)
  const { encryptedDek } = await wrapWithKek(dek, kek)
  return { encryptedDek, salt: toBase64(saltBytes) }
}

// Recovery Key 解锁：输入密钥 → HKDF → KEK → 解包 DEK（完整路径）
export async function unwrapWithRecoveryKey(
  encryptedDek: string,
  salt: string,
  recoveryKey: string,
): Promise<CryptoKey> {
  const kek = await deriveKek(decodeRecoveryKey(recoveryKey), fromBase64(salt), 'recovery-kek')
  const { iv, data } = decodeWrapped(encryptedDek)
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, data)
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

// PRF 输出 → KEK（HKDF(salt=S)，S 即 passkey_prf wrapper 的 salt 字段）
// 注意：只派生 KEK，解包 DEK 由调用方用 unwrapDekFromWrapper 完成
export async function derivePrfKek(prfOutputB64: string, salt: string): Promise<CryptoKey> {
  return deriveKek(fromBase64(prfOutputB64), fromBase64(salt), 'passkey-kek')
}
```

在 `lib/client/crypto/encryption.ts` 追加 wrapper 约定的解包（与 encodeWrapped 内嵌 IV 格式配套）:

```ts
export async function unwrapDekFromWrapper(kek: CryptoKey, encryptedDek: string): Promise<CryptoKey> {
  const { iv, data } = decodeWrapped(encryptedDek)
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, data)
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
```

（encryption.ts 需要 import `decodeWrapped` from './wrapper'。）

- [ ] **Step 5: 运行测试修复直到通过**

```bash
npm test
```

Expected: 全部 PASS（base64/kdf/encryption/recovery-key/setup）。若 setup 测试因实现细节失败（如 base64 编码选择），以测试为准修正实现。

- [ ] **Step 6: 检查 + 提交**

```bash
npm run typecheck && npm run lint
git add -A
git commit -m "feat: key_wrappers API + PRF/Recovery 包裹与解锁模块
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Phase 5 — Diary CRUD API

**Files:**
- Create: `app/api/diary/route.ts`, `app/api/diary/[id]/route.ts`
- Create: `app/api/draft/route.ts`

- [ ] **Step 1: 认证辅助（抽取公共函数）**

创建 `lib/server/auth.ts`:

```ts
import { verifySessionToken } from './session'

export async function isAuthed(req: Request): Promise<boolean> {
  const cookie = req.headers.get('cookie') ?? ''
  const token = cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith('qo_session='))?.split('=')[1]
  return token ? verifySessionToken(decodeURIComponent(token)) : false
}

export async function requireAuth(req: Request): Promise<boolean> {
  return isAuthed(req)
}
```

重构 `app/api/keys/wrappers/route.ts` 使用 `isAuthed`（删除内部 authed 函数）。

- [ ] **Step 2: 日记列表 + 新建**

`app/api/diary/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { diaryEntries } from '@/lib/server/db/schema'
import { desc } from 'drizzle-orm'
import { requireAuth } from '@/lib/server/auth'
import { diaryCreateSchema } from '@/lib/server/validation'
import { rateLimit } from '@/lib/server/ratelimit'

export async function GET(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100) || 100, 200)
  const entries = await db.select().from(diaryEntries).orderBy(desc(diaryEntries.createdAt)).limit(limit)
  return NextResponse.json({ entries })
}

export async function POST(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!rateLimit('diary-create', 30, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const body = diaryCreateSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'bad_request', details: body.error.issues }, { status: 400 })
  const { ciphertext, iv, encryptionVersion, latitude, longitude, locationAccuracy, timezone } = body.data
  const [entry] = await db.insert(diaryEntries).values({
    ciphertext, iv, encryptionVersion,
    latitude: latitude ?? null, longitude: longitude ?? null, locationAccuracy: locationAccuracy ?? null,
    timezone: timezone ?? null,
  }).returning()
  return NextResponse.json({ entry }, { status: 201 })
}
```

- [ ] **Step 3: 详情 / 更新 / 删除**

`app/api/diary/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { diaryEntries } from '@/lib/server/db/schema'
import { and, eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/server/auth'
import { diaryUpdateSchema } from '@/lib/server/validation'

function parseId(param: string): string | null {
  return /^[0-9a-fA-F-]{36}$/.test(param) ? param : null
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Next 15+: params 为 Promise
  const { id } = await params
  if (!parseId(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const [entry] = await db.select().from(diaryEntries).where(eq(diaryEntries.id, id))
  if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ entry })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  if (!parseId(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const body = diaryUpdateSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'bad_request', details: body.error.issues }, { status: 400 })
  const patch = body.data
  const [updated] = await db.update(diaryEntries)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(diaryEntries.id, id))
    .returning()
  if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ entry: updated })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  if (!parseId(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const [deleted] = await db.delete(diaryEntries).where(eq(diaryEntries.id, id)).returning()
  if (!deleted) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Step 4: 草稿 API（单行 upsert）**

`app/api/draft/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { drafts } from '@/lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/server/auth'
import { draftPutSchema } from '@/lib/server/validation'
import { rateLimit } from '@/lib/server/ratelimit'

const DRAFT_ID = '00000000-0000-0000-0000-000000000001'

export async function GET(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const [draft] = await db.select().from(drafts).where(eq(drafts.id, DRAFT_ID))
  return NextResponse.json({ draft: draft ?? null })
}

export async function PUT(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!rateLimit('draft-save', 60, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const body = draftPutSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'bad_request', details: body.error.issues }, { status: 400 })
  const { ciphertext, iv, encryptionVersion } = body.data
  const now = new Date()
  const [draft] = await db.insert(drafts)
    .values({ id: DRAFT_ID, ciphertext, iv, encryptionVersion, updatedAt: now })
    .onConflictDoUpdate({ target: drafts.id, set: { ciphertext, iv, encryptionVersion, updatedAt: now } })
    .returning()
  return NextResponse.json({ draft })
}

export async function DELETE(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await db.delete(drafts).where(eq(drafts.id, DRAFT_ID))
  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Step 5: 检查 + 提交**

```bash
npm run typecheck && npm run lint && npm run build
git add -A
git commit -m "feat: diary CRUD + draft API（认证 + zod 校验 + 长度限制）
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Phase 6 — 首页编辑器 + 登录/初始化流程接线

**Files:**
- Create: `lib/client/session.ts`, `app/login/page.tsx`, `app/setup/page.tsx`, `app/page.tsx`, `components/DiaryEditor.tsx`, `components/AutoTextarea.tsx`
- Modify: `app/layout.tsx`（viewport/meta）

- [ ] **Step 1: 客户端类型 + 会话模块**

`lib/client/types.ts`:

```ts
export interface WrappedKeyRow {
  id: string
  wrapperType: 'passkey_prf' | 'recovery'
  credentialId: string | null
  encryptedDek: string
  salt: string
  encryptionVersion: number
}
```

`lib/client/session.ts`:

```ts
import { authenticatePasskey } from './webauthn'
import { derivePrfKek, unwrapWithRecoveryKey } from './crypto/setup'
import { unwrapDekFromWrapper } from './crypto/encryption'
import type { WrappedKeyRow } from './types'

export interface SessionState {
  initialized: boolean
  authenticated: boolean
  credentialCount: number
  prfWrappers: number
  hasRecoveryWrapper: boolean
}

// 解锁后的 DEK 仅存内存（模块级变量），刷新即清空 —— 满足规格二十六节
let dek: CryptoKey | null = null

export function getDek(): CryptoKey | null { return dek }
export function clearDek(): void { dek = null }

export async function fetchSession(): Promise<SessionState> {
  const res = await fetch('/api/auth/session')
  return res.json()
}

export async function fetchWrappers(): Promise<WrappedKeyRow[]> {
  const res = await fetch('/api/keys/wrappers')
  if (!res.ok) throw new Error('获取密钥包装失败')
  const data = await res.json()
  return data.wrappers as WrappedKeyRow[]
}

export interface LoginResult { ok: boolean; error?: string; via: 'prf' | 'recovery' }

// Passkey + PRF 解锁
export async function loginWithPasskey(): Promise<LoginResult> {
  const optionsRes = await fetch('/api/auth/login/options')
  const { token, options } = await optionsRes.json()
  const wrappers = await fetchWrappers() // 需先有 session 才能 GET —— 见下方说明
  // ...
}
```

**修正登录流程（关键）**：`GET /api/keys/wrappers` 需要认证，而解锁时尚未登录。**必须先完成 WebAuthn 认证（POST /api/auth/login 设置 session），再拉取 wrappers 解锁**。因此真实顺序：

```ts
export async function loginWithPasskey(): Promise<LoginResult> {
  const optionsRes = await fetch('/api/auth/login/options')
  const { token, options } = await optionsRes.json()
  const prfEval = await getPrfEval() // 从服务器草稿？—— 见下方 prfEval 存储决策
  const { assertion, prfResult } = await authenticatePasskey(options, prfEval)
  const loginRes = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, assertion }),
  })
  if (!loginRes.ok) return { ok: false, error: '登录验证失败' }
  // 登录成功后拉取 wrappers 并解锁
  const wrappers = await fetchWrappers()
  const prfWrapper = wrappers.find((w) => w.wrapperType === 'passkey_prf')
  if (prfResult && prfWrapper) {
    const kek = await derivePrfKek(prfResult, prfWrapper.salt)
    dek = await unwrapDekFromWrapper(kek, prfWrapper.encryptedDek)
    return { ok: true, via: 'prf' }
  }
  return { ok: false, error: 'prf_unavailable' } // 前端转入 recovery 输入模式
}
```

**PRF eval 输入 S 的存储决策**：S 即 wrapper_p 的 salt（存服务器），注册时生成。登录前拉不到 wrappers（未认证）——但 S 不敏感。方案：`GET /api/auth/login/options` 响应中附加 `prfEval`（服务器从 key_wrappers 表读取第一个 passkey_prf wrapper 的 salt 返回）。修改 Task 4 的 login/options route 返回 `prfEval`:

```ts
// app/api/auth/login/options/route.ts 增加：
import { keyWrappers } from '@/lib/server/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
// 在返回前：
const [pw] = await db.select().from(keyWrappers).where(and(eq(keyWrappers.wrapperType, 'passkey_prf'), eq(keyWrappers.credentialId, all[0]?.credentialId ?? '')))
// 简化：任意 passkey_prf wrapper 的 salt
const [anyPrf] = await db.select().from(keyWrappers).where(eq(keyWrappers.wrapperType, 'passkey_prf')).limit(1)
// 返回 { token, options, prfEval: anyPrf?.salt ?? null }
```

（prfEval 不需要匹配具体 credential：S 对所有 passkey 一致。）

- [ ] **Step 2: Recovery Key 解锁（统一入口）**

**recovery-only 登录路径（关键决策）**：若用户丢失全部 passkey（换设备场景），无法 WebAuthn 认证，但规格要求 Recovery Key 支持灾难恢复。服务器无法解密 wrapper（它没有 KEK），因此**在 key_wrappers 表加 `recovery_key_hash` 列**（nullable，仅 recovery 行有值），存 SHA-256(recovery key) 十六进制。recovery key 为 256-bit 高熵，哈希不可逆且不可爆破（业界可接受做法）。

`lib/client/session.ts` 追加:

```ts
// Recovery Key 解锁统一入口：
//  - 已有 session（passkey 已认证但 PRF 不可用）→ 直接拉 wrappers 解包
//  - 无 session（丢失全部 passkey）→ 先调 recovery-login（服务器 SHA-256 校验后签发 session），再解包
export async function unlockWithRecoveryKey(recoveryKey: string): Promise<LoginResult> {
  let wrappers: WrappedKeyRow[]
  try {
    wrappers = await fetchWrappers()
  } catch {
    const res = await fetch('/api/auth/recovery-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recoveryKey }),
    })
    if (!res.ok) return { ok: false, error: '恢复密钥验证失败' }
    wrappers = await fetchWrappers()
  }
  const recWrapper = wrappers.find((w) => w.wrapperType === 'recovery')
  if (!recWrapper) return { ok: false, error: '无恢复包装' }
  try {
    dek = await unwrapWithRecoveryKey(recWrapper.encryptedDek, recWrapper.salt, recoveryKey)
    return { ok: true, via: 'recovery' }
  } catch {
    return { ok: false, error: '恢复密钥解密失败' }
  }
}
```

实现 `app/api/auth/recovery-login/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { db } from '@/lib/server/db'
import { keyWrappers } from '@/lib/server/db/schema'
import { and, eq, isNotNull } from 'drizzle-orm'
import { createSession } from '@/lib/server/session'
import { rateLimit } from '@/lib/server/ratelimit'

export async function POST(req: Request) {
  if (!rateLimit('recovery-login', 5, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const body = (await req.json().catch(() => null)) as { recoveryKey?: string } | null
  if (!body?.recoveryKey || !/^[A-Za-z0-9_-]{43}$/.test(body.recoveryKey)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  const hash = createHash('sha256').update(body.recoveryKey).digest('hex')
  const [rec] = await db.select().from(keyWrappers).where(and(eq(keyWrappers.wrapperType, 'recovery'), isNotNull(keyWrappers.recoveryKeyHash)))
  if (!rec || rec.recoveryKeyHash !== hash) return NextResponse.json({ error: 'invalid_recovery_key' }, { status: 401 })
  const session = await createSession()
  const res = NextResponse.json({ ok: true })
  res.cookies.set('qo_session', session, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 })
  return res
}
```

更新 schema（Task 2 中 keyWrappers 表追加列）:

```ts
recoveryKeyHash: text('recovery_key_hash'), // 仅 recovery 行：SHA-256(recovery key)，用于灾难恢复登录校验
```

生成新 migration:

```bash
npm run db:generate && npm run db:migrate
```

`lib/client/session.ts` 增加:

```ts
export async function recoveryOnlyLogin(recoveryKey: string): Promise<LoginResult> {
  const res = await fetch('/api/auth/recovery-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recoveryKey }),
  })
  if (!res.ok) return { ok: false, error: '恢复密钥验证失败' }
  const wrappers = await fetchWrappers()
  const recWrapper = wrappers.find((w) => w.wrapperType === 'recovery')
  if (!recWrapper) return { ok: false, error: '无恢复包装' }
  try {
    dek = await unwrapWithRecoveryKey(recWrapper.encryptedDek, recWrapper.salt, recoveryKey)
    return { ok: true, via: 'recovery' }
  } catch {
    return { ok: false, error: '恢复密钥解密失败' }
  }
}
```

- [ ] **Step 3: 登录页**

`app/login/page.tsx`（client component，极简）:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fetchSession, loginWithPasskey, unlockWithRecoveryKey } from '@/lib/client/session'

export default function LoginPage() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'passkey' | 'recovery'>('passkey')
  const [recoveryKey, setRecoveryKey] = useState('')

  useEffect(() => { void (async () => { const s = await fetchSession(); if (!s.initialized) router.replace('/setup') })() }, [router])

  async function handlePasskey() {
    setBusy(true); setError(null)
    const result = await loginWithPasskey()
    if (result.ok) { router.replace('/'); return }
    if (result.error === 'prf_unavailable') { setMode('recovery'); setBusy(false); return }
    setError(result.error ?? '登录失败'); setBusy(false)
  }

  async function handleRecoverySubmit() {
    setBusy(true); setError(null)
    const result = await unlockWithRecoveryKey(recoveryKey.trim())
    if (result.ok) { router.replace('/'); return }
    setError(result.error ?? '登录失败'); setBusy(false)
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 safe-pb">
      <h1 className="text-2xl font-semibold text-neutral-800 dark:text-neutral-100">我的日记</h1>
      {mode === 'passkey' ? (
        <button
          onClick={handlePasskey}
          disabled={busy}
          className="w-full max-w-xs rounded-2xl bg-neutral-900 px-6 py-4 text-base font-medium text-white active:scale-[0.98] dark:bg-neutral-100 dark:text-neutral-900"
        >
          {busy ? '正在验证…' : '使用 Face ID 解锁'}
        </button>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void handleRecoverySubmit() }} className="flex w-full max-w-xs flex-col gap-3">
          <p className="text-sm text-neutral-500">此浏览器不支持 PRF，请输入恢复密钥解锁</p>
          <input
            value={recoveryKey}
            onChange={(e) => setRecoveryKey(e.target.value)}
            placeholder="粘贴恢复密钥"
            className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-base outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <button type="submit" disabled={busy} className="rounded-xl bg-neutral-900 px-6 py-4 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">
            {busy ? '正在解锁…' : '解锁'}
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {mode === 'recovery' && (
        <button onClick={() => setMode('passkey')} className="text-sm text-neutral-400 underline">返回 Face ID</button>
      )}
    </main>
  )
}
```

- [ ] **Step 4: 初始化页（setup）**

`app/setup/page.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { registerPasskey, authenticatePasskey } from '@/lib/client/webauthn'
import { generateDek, unwrapDekFromWrapper } from '@/lib/client/crypto/encryption'
import { createWrappedDek, derivePrfKek } from '@/lib/client/crypto/setup'
import { generateRecoveryKey } from '@/lib/client/crypto/recovery-key'
import { prfEvalB64 } from '@/lib/client/crypto/prf'
import { fetchSession } from '@/lib/client/session'

export default function SetupPage() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<'intro' | 'recovery' | 'done'>('intro')
  const [error, setError] = useState<string | null>(null)
  const [recoveryKey, setRecoveryKey] = useState('')
  const prfEvalRef = useRef<Uint8Array | null>(null)

  useEffect(() => { void (async () => { const s = await fetchSession(); if (s.initialized) router.replace('/login') })() }, [router])

  async function start() {
    setBusy(true); setError(null)
    try {
      // 1. 生成 DEK 与 PRF eval 输入 S
      const dek = await generateDek()
      const prfEval = crypto.getRandomValues(new Uint8Array(32))
      prfEvalRef.current = prfEval

      // 2. 获取注册选项并注册 Passkey（PRF 扩展由 registerPasskey 注入）
      const optsRes = await fetch('/api/auth/register/options')
      if (!optsRes.ok) throw new Error('初始化被拒绝（系统可能已初始化）')
      const { token, options } = await optsRes.json()
      const { registration, prfEnabled } = await registerPasskey(options, prfEval)

      // 3. 先注册 credential（成功后设置 session）——wrapper 保存需要认证
      const regResp = await fetch('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, registration }),
      })
      if (!regResp.ok) throw new Error('注册失败')

      // 4. 若 PRF 可用：立即认证同一 passkey 获取 PRF 输出 → KEK → 包裹 DEK → 保存 wrapper_p
      if (prfEnabled) {
        const loginRes = await fetch('/api/auth/login/options')
        const loginOpts = await loginRes.json()
        const { assertion, prfResult } = await authenticatePasskey(loginOpts.options, prfEvalB64(prfEval))
        const loginResp = await fetch('/api/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: loginOpts.token, assertion }),
        })
        if (!loginResp.ok) throw new Error('Passkey 验证失败')
        if (!prfResult) throw new Error('PRF 未返回结果')
        const kek = await derivePrfKek(prfResult, prfEvalB64(prfEval))
        const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dek))
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw))
        const combined = new Uint8Array(iv.length + cipher.length)
        combined.set(iv, 0); combined.set(cipher, iv.length)
        const wrapP = await fetch('/api/keys/wrappers', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wrapperType: 'passkey_prf',
            credentialId: (registration as { id?: string }).id ?? '',
            encryptedDek: btoa(String.fromCharCode(...combined)),
            salt: prfEvalB64(prfEval),
            encryptionVersion: 1,
          }),
        })
        if (!wrapP.ok) throw new Error('保存 Passkey 包装失败')
      }

      // 5. 生成 Recovery Key 与 wrapper_r（含服务器校验哈希），保存
      const recoveryKey = generateRecoveryKey()
      const recoveryWrapper = await createWrappedDek(dek, new TextEncoder().encode(recoveryKey), 'recovery-kek')
      const wrapR = await fetch('/api/keys/wrappers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wrapperType: 'recovery',
          encryptedDek: recoveryWrapper.encryptedDek,
          salt: recoveryWrapper.salt,
          encryptionVersion: 1,
          recoveryKeyHash: await sha256Hex(recoveryKey),
        }),
      })
      if (!wrapR.ok) throw new Error('保存恢复包装失败')

      setRecoveryKey(recoveryKey)
      setStep('recovery')
    } catch (e) {
      setError(e instanceof Error ? e.message : '初始化失败')
    } finally {
      setBusy(false)
    }
  }

  function finish() {
    // 提示用户保存 recovery key 后进入
    if (!recoveryKey) return
    void navigator.clipboard?.writeText(recoveryKey)
    router.replace('/')
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      {step === 'intro' && (
        <>
          <h1 className="text-2xl font-semibold">创建你的私人日记</h1>
          <p className="max-w-xs text-center text-sm text-neutral-500">日记内容将端到端加密，只有你的设备能解密。</p>
          <button onClick={start} disabled={busy} className="w-full max-w-xs rounded-2xl bg-neutral-900 px-6 py-4 font-medium text-white disabled:opacity-50">
            {busy ? '正在创建…' : '使用 Face ID 创建通行密钥'}
          </button>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </>
      )}
      {step === 'recovery' && (
        <>
          <h1 className="text-xl font-semibold">保存你的恢复密钥</h1>
          <p className="text-center text-sm text-neutral-500">它只显示一次，请保存到安全密码管理器。丢失后无法恢复日记。</p>
          <code className="break-all rounded-xl bg-neutral-100 px-4 py-3 text-sm dark:bg-neutral-800">{recoveryKey}</code>
          <button onClick={() => void navigator.clipboard?.writeText(recoveryKey)} className="text-sm text-neutral-500 underline">复制恢复密钥</button>
          <button onClick={finish} className="w-full max-w-xs rounded-2xl bg-neutral-900 px-6 py-4 font-medium text-white">我已保存，进入日记</button>
        </>
      )}
    </main>
  )
}
```

**setup 顺序约束（已按此修正上方代码）**：wrapper POST 需要 session，因此顺序为：register/options → startRegistration → **POST register（设置 session）→ 认证取 PRF（若支持）→ POST wrappers（passkey_prf）→ POST wrappers（recovery）**。PRF eval 输入 S 由客户端生成并作为 wrapper 的 salt 存服务器；后续每次登录的 S 由服务器从已存 wrapper 返回（`GET /api/auth/login/options` 附带 prfEval）。

**更新 wrapperSchema**（validation.ts）:

```ts
export const wrapperSchema = z.strictObject({
  wrapperType: z.enum(['passkey_prf', 'recovery']),
  credentialId: z.string().min(1).max(512).optional(), // recovery 不需要
  encryptedDek: z.string().min(1).max(2048),
  salt: z.string().min(1).max(256),
  encryptionVersion: z.number().int().min(1).max(10).default(1),
  recoveryKeyHash: z.string().length(64).optional(), // 仅 recovery
})
```

POST handler 相应处理：passkey_prf 需要 credentialId 且校验存在；recovery 需要 recoveryKeyHash。

setup 页最终实现顺序按上述 1-6。实现时以本步说明为准（Step 4 的代码草稿需按此顺序重构，不必逐字照抄）。

- [ ] **Step 5: 首页编辑器（核心 UI）**

`components/AutoTextarea.tsx`（自动增长 + 键盘遮挡防护）:

```tsx
'use client'

import { useEffect, useRef } from 'react'

export default function AutoTextarea({ value, onChange, placeholder, autoFocus }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className="w-full flex-1 resize-none bg-transparent text-lg leading-relaxed outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-600"
      style={{ minHeight: '50vh' }}
    />
  )
}
```

`components/DiaryEditor.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import AutoTextarea from './AutoTextarea'
import { getDek, clearDek } from '@/lib/client/session'
import { encryptText } from '@/lib/client/crypto/encryption'
import { getPosition } from '@/lib/client/location'

export default function DiaryEditor() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [savedTime, setSavedTime] = useState('')
  const [recovering, setRecovering] = useState(false)
  const dekRef = useRef<CryptoKey | null>(null)
  const textRef = useRef('')

  // DEK 检查：无 DEK 说明未解锁
  useEffect(() => { dekRef.current = getDek() }, [])
  // 键盘遮挡防护：visualViewport 滚动
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      const el = document.activeElement
      if (el instanceof HTMLTextAreaElement) {
        el.scrollIntoView({ block: 'center' })
        el.style.maxHeight = `${vv.height - 120}px`
      }
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [])

  async function save() {
    const dek = getDek()
    const body = textRef.current.trim()
    if (!dek || !body) { setStatus('idle'); return }
    setStatus('saving')
    try {
      const loc = await getPosition(2000)
      const { ciphertext, iv } = await encryptText(dek, body)
      const res = await fetch('/api/diary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ciphertext, iv, encryptionVersion: 1,
          latitude: loc?.latitude ?? null, longitude: loc?.longitude ?? null,
          locationAccuracy: loc?.accuracy ?? null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      })
      if (!res.ok) throw new Error('save failed')
      await fetch('/api/draft', { method: 'DELETE' })
      await clearLocalDraft()
      const now = new Date()
      setSavedTime(now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }))
      setStatus('saved')
      setText(''); textRef.current = ''
      setTimeout(() => setStatus('idle'), 3000)
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="flex min-h-dvh flex-col px-5 safe-pt safe-pb">
      <header className="flex items-center justify-between py-3">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">我的日记</h1>
        <a href="/settings" className="text-sm text-neutral-400">设置</a>
      </header>
      <AutoTextarea
        value={text}
        onChange={(v) => { setText(v); textRef.current = v; void onDraftChange(v) }}
        placeholder="写下此刻……"
        autoFocus
      />
      <footer className="flex items-center justify-between pb-safe py-4">
        <p className="text-sm text-neutral-400">
          {status === 'saving' && '正在保存…'}
          {status === 'saved' && `已保存 · ${savedTime}`}
          {status === 'error' && '保存失败，请重试'}
        </p>
        <button
          onClick={() => void save()}
          disabled={!text.trim() || status === 'saving'}
          className="rounded-full bg-neutral-900 px-8 py-3 font-medium text-white disabled:opacity-30 dark:bg-neutral-100 dark:text-neutral-900"
        >
          保存
        </button>
      </footer>
    </div>
  )
}

// 防抖草稿在 Task 10 实现；先声明占位（从 Draft 模块导入）
function onDraftChange(text: string): Promise<void> { return Promise.resolve() }
function clearLocalDraft(): Promise<void> { return Promise.resolve() }
```

（Task 10 将替换这两个占位为真实实现——从 `lib/client/draft-sync.ts` 导入。占位函数保留让 Task 9 可构建。）

- [ ] **Step 6: 首页 + 布局接线**

`app/page.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import DiaryEditor from '@/components/DiaryEditor'
import { fetchSession, getDek } from '@/lib/client/session'

export default function HomePage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void (async () => {
      const s = await fetchSession()
      if (!s.initialized) { router.replace('/setup'); return }
      if (!s.authenticated) { router.replace('/login'); return }
      if (!getDek()) { router.replace('/login'); return }
      setReady(true)
    })()
  }, [router])

  if (!ready) return null
  return <DiaryEditor />
}
```

`app/layout.tsx` 更新（viewport-fit + iOS meta + 深色主题）:

```tsx
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '我的日记',
  description: '端到端加密的私人日记',
  appleWebApp: { capable: true, title: '我的日记', statusBarStyle: 'default' },
  manifest: '/manifest.webmanifest',
  icons: { apple: [{ url: '/icons/icon-180.png', sizes: '180x180' }] },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  )
}
```

`app/globals.css` 追加安全区工具类:

```css
.safe-pt { padding-top: env(safe-area-inset-top); }
.safe-pb { padding-bottom: env(safe-area-inset-bottom); }
.pb-safe { padding-bottom: max(env(safe-area-inset-bottom), 1rem); }
```

- [ ] **Step 7: 检查 + 提交**

```bash
npm run typecheck && npm run lint && npm run build
git add -A
git commit -m "feat: 首页编辑器 + 登录/初始化流程（PRF + Recovery 双路径）
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: Phase 7 — 历史列表 + 详情/编辑/删除

**Files:**
- Create: `app/history/page.tsx`, `app/entry/[id]/page.tsx`, `components/EntryList.tsx`

- [ ] **Step 1: 历史列表页**

`app/history/page.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fetchSession, getDek } from '@/lib/client/session'
import { decryptText } from '@/lib/client/crypto/encryption'

interface Entry { id: string; ciphertext: string; iv: string; createdAt: string; latitude: number | null }

export default function HistoryPage() {
  const router = useRouter()
  const [groups, setGroups] = useState<{ date: string; items: { id: string; time: string; preview: string; lat: number | null }[] }[]>([])

  useEffect(() => {
    void (async () => {
      const s = await fetchSession()
      if (!s.authenticated || !getDek()) { router.replace('/login'); return }
      const dek = getDek()!
      const res = await fetch('/api/diary?limit=200')
      const { entries } = await res.json() as { entries: Entry[] }
      const decrypted: { id: string; createdAt: Date; preview: string; lat: number | null }[] = []
      for (const e of entries) {
        try {
          const plain = await decryptText(dek, e.ciphertext, e.iv)
          decrypted.push({ id: e.id, createdAt: new Date(e.createdAt), preview: plain.split('\n')[0], lat: e.latitude })
        } catch { /* 解密失败跳过（数据损坏） */ }
      }
      const sorted = decrypted.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      const grouped = new Map<string, typeof decrypted>()
      for (const item of sorted) {
        const key = item.createdAt.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
        grouped.set(key, [...(grouped.get(key) ?? []), item])
      }
      setGroups([...grouped.entries()].map(([date, items]) => ({
        date,
        items: items.map((i) => ({
          id: i.id,
          time: i.createdAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
          preview: i.preview,
          lat: i.lat,
        })),
      })))
    })()
  }, [router])

  return (
    <main className="min-h-dvh px-5 safe-pt safe-pb">
      <header className="flex items-center justify-between py-3">
        <Link href="/" className="text-neutral-400">‹ 返回</Link>
        <h1 className="text-lg font-semibold">历史</h1>
        <span className="w-8" />
      </header>
      <div className="flex flex-col gap-6 pb-10">
        {groups.map((g) => (
          <section key={g.date}>
            <h2 className="mb-2 text-sm font-medium text-neutral-400">{g.date}</h2>
            <ul className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
              {g.items.map((item) => (
                <li key={item.id}>
                  <Link href={`/entry/${item.id}`} className="flex flex-col gap-0.5 py-3 active:opacity-60">
                    <span className="text-sm tabular-nums text-neutral-400">{item.time}</span>
                    <span className="line-clamp-2 whitespace-pre-wrap text-neutral-800 dark:text-neutral-200">{item.preview}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {groups.length === 0 && <p className="pt-20 text-center text-sm text-neutral-400">还没有日记</p>}
      </div>
    </main>
  )
}
```

- [ ] **Step 2: 详情页（查看/编辑/删除）**

`app/entry/[id]/page.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { fetchSession, getDek } from '@/lib/client/session'
import { decryptText, encryptText } from '@/lib/client/crypto/encryption'

interface Entry {
  id: string; ciphertext: string; iv: string; createdAt: string; updatedAt: string
  latitude: number | null; longitude: number | null; locationAccuracy: number | null; timezone: string | null
}

export default function EntryPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [entry, setEntry] = useState<Entry | null>(null)
  const [plain, setPlain] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const s = await fetchSession()
      if (!s.authenticated || !getDek()) { router.replace('/login'); return }
      const res = await fetch(`/api/diary/${id}`)
      if (!res.ok) { router.replace('/history'); return }
      const { entry } = await res.json() as { entry: Entry }
      setEntry(entry)
      try { setPlain(await decryptText(getDek()!, entry.ciphertext, entry.iv)) } catch { setPlain('(解密失败，数据可能已损坏)') }
    })()
  }, [id, router])

  const saveEdit = useCallback(async () => {
    if (!entry || !plain.trim()) return
    setBusy(true)
    try {
      const dek = getDek()!
      const { ciphertext, iv } = await encryptText(dek, plain)
      const res = await fetch(`/api/diary/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ciphertext, iv }),
      })
      if (!res.ok) throw new Error()
      const updated = await res.json()
      setEntry({ ...entry, ...updated.entry })
      setEditing(false)
    } finally { setBusy(false) }
  }, [entry, plain, id])

  const remove = useCallback(async () => {
    if (!confirm('确定删除这篇日记吗？删除后无法恢复。')) return
    const res = await fetch(`/api/diary/${id}`, { method: 'DELETE' })
    if (res.ok) router.replace('/history')
  }, [id, router])

  if (!entry) return <main className="min-h-dvh px-5 safe-pt" />
  const created = new Date(entry.createdAt)
  return (
    <main className="min-h-dvh px-5 safe-pt safe-pb">
      <header className="flex items-center justify-between py-3">
        <Link href="/history" className="text-neutral-400">‹ 历史</Link>
        <h1 className="text-lg font-semibold">日记</h1>
        <button onClick={() => setEditing(!editing)} className="text-sm text-neutral-400">{editing ? '取消' : '编辑'}</button>
      </header>
      <p className="text-sm tabular-nums text-neutral-400">
        {created.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })} {created.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
      </p>
      {entry.latitude != null && (
        <p className="mt-1 text-xs text-neutral-400">记录了当前位置 · 点击查看</p>
      )}
      {editing ? (
        <>
          <textarea
            value={plain} onChange={(e) => setPlain(e.target.value)}
            className="mt-3 min-h-[50vh] w-full resize-none bg-transparent text-lg leading-relaxed outline-none"
          />
          <button onClick={() => void saveEdit()} disabled={busy} className="mt-4 w-full rounded-2xl bg-neutral-900 py-4 font-medium text-white disabled:opacity-50">
            {busy ? '保存中…' : '保存修改'}
          </button>
        </>
      ) : (
        <p className="mt-4 whitespace-pre-wrap text-lg leading-relaxed text-neutral-800 dark:text-neutral-200">{plain}</p>
      )}
      {!editing && (
        <button onClick={() => void remove()} className="mt-10 w-full rounded-2xl border border-red-200 py-3 text-sm text-red-500 dark:border-red-900">
          删除日记
        </button>
      )}
    </main>
  )
}
```

- [ ] **Step 3: 检查 + 提交**

```bash
npm run typecheck && npm run lint && npm run build
git add -A
git commit -m "feat: 历史列表 + 详情/编辑/删除（客户端解密渲染）
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: Phase 8 — 草稿系统（IndexedDB + 同步 + 冲突）

**Files:**
- Create: `lib/client/idb.ts`, `lib/client/draft-sync.ts`
- Modify: `components/DiaryEditor.tsx`（接入真实草稿逻辑）
- Test: `tests/draft-sync.test.ts`

- [ ] **Step 1: IndexedDB 封装（无第三方库）**

`lib/client/idb.ts`:

```ts
// 极简 Promise 化 IndexedDB 封装（单库单库表，key-value）
const DB_NAME = 'quiet-orbit'
const STORE = 'kv'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function idbDelete(key: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function idbClearAll(): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
```

- [ ] **Step 2: 草稿同步模块（含冲突决策，先写测试）**

`tests/draft-sync.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { pickNewer } from '../../lib/client/draft-sync'

describe('pickNewer 冲突决策', () => {
  it('服务器更新 → 选服务器', () => {
    const local = { updatedAt: 1000, text: 'local' }
    const server = { updatedAt: 2000, text: 'server' }
    expect(pickNewer(local, server)).toBe(server)
  })
  it('本地更新 → 选本地', () => {
    const local = { updatedAt: 2000, text: 'local' }
    const server = { updatedAt: 1000, text: 'server' }
    expect(pickNewer(local, server)).toBe(local)
  })
  it('相同时间 → 选服务器（稳定）', () => {
    const local = { updatedAt: 1000, text: 'local' }
    const server = { updatedAt: 1000, text: 'server' }
    expect(pickNewer(local, server)).toBe(server)
  })
  it('本地空草稿不覆盖服务器', () => {
    const local = { updatedAt: 0, text: '' }
    const server = { updatedAt: 1000, text: 'server' }
    expect(pickNewer(local, server)).toBe(server)
  })
})
```

- [ ] **Step 3: 实现 draft-sync**

`lib/client/draft-sync.ts`:

```ts
import { idbGet, idbSet, idbDelete } from './idb'

export interface DraftRecord {
  ciphertext: string
  iv: string
  encryptionVersion: number
  updatedAt: number // epoch ms
}

const LOCAL_KEY = 'draft'

// 冲突决策：更新时间较新者胜；空内容视为无草稿
export function pickNewer(
  local: { updatedAt: number; text: string } | null,
  server: { updatedAt: number } | null,
): { updatedAt: number; text: string } | null {
  if (!local && !server) return null
  if (!server) return local
  if (!local || local.text.trim() === '') return { updatedAt: server.updatedAt, text: '' }
  return local.updatedAt > server.updatedAt ? local : { updatedAt: server.updatedAt, text: '' }
}

export async function loadLocalDraft(): Promise<DraftRecord | null> {
  return (await idbGet<DraftRecord>(LOCAL_KEY)) ?? null
}

export async function saveLocalDraft(record: DraftRecord): Promise<void> {
  await idbSet(LOCAL_KEY, record)
}

export async function clearLocalDraft(): Promise<void> {
  await idbDelete(LOCAL_KEY)
}

export async function fetchServerDraft(): Promise<{ ciphertext: string; iv: string; updatedAt: string } | null> {
  const res = await fetch('/api/draft')
  if (!res.ok) return null
  const { draft } = await res.json()
  return draft ? { ciphertext: draft.ciphertext, iv: draft.iv, updatedAt: draft.updatedAt } : null
}

export async function pushServerDraft(record: DraftRecord): Promise<boolean> {
  const res = await fetch('/api/draft', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ciphertext: record.ciphertext, iv: record.iv, encryptionVersion: record.encryptionVersion }),
  })
  return res.ok
}
```

（草稿的明文比较仅用于"空判断"——注意 pickNewer 的 local.text 在真实调用时传加密前的明文字符串，仅本地使用，不跨网络。）

- [ ] **Step 4: 接入 DiaryEditor（替换占位）**

修改 `components/DiaryEditor.tsx`:

```tsx
// 新增 import
import { clearLocalDraft, loadLocalDraft, pushServerDraft, saveLocalDraft, fetchServerDraft } from '@/lib/client/draft-sync'
import { decryptText } from '@/lib/client/crypto/encryption'

// 状态新增
const [showDraftBanner, setShowDraftBanner] = useState(false)
const pendingDraftRef = useRef<{ ciphertext: string; iv: string } | null>(null)
const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

// 页面加载：检查本地/服务器草稿
useEffect(() => {
  void (async () => {
    const dek = getDek()
    if (!dek) return
    const local = await loadLocalDraft()
    const server = await fetchServerDraft()
    let best: { ciphertext: string; iv: string; updatedAt: number } | null = null
    if (local) best = { ciphertext: local.ciphertext, iv: local.iv, updatedAt: local.updatedAt }
    if (server) {
      const decision = pickNewer(
        { updatedAt: local?.updatedAt ?? 0, text: local ? await tryDecrypt(dek, local) : '' },
        { updatedAt: new Date(server.updatedAt).getTime() },
      )
      if (decision && decision.text === '' && !local) {
        best = { ciphertext: server.ciphertext, iv: server.iv, updatedAt: new Date(server.updatedAt).getTime() }
      }
    }
    if (best) {
      pendingDraftRef.current = { ciphertext: best.ciphertext, iv: best.iv }
      setShowDraftBanner(true)
    }
  })()
}, [])

async function tryDecrypt(dek: CryptoKey, rec: { ciphertext: string; iv: string }): Promise<string> {
  try { return await decryptText(dek, rec.ciphertext, rec.iv) } catch { return '' }
}

async function restoreDraft() {
  const dek = getDek()
  const pending = pendingDraftRef.current
  if (!dek || !pending) return
  try {
    const plain = await decryptText(dek, pending.ciphertext, pending.iv)
    setText(plain); textRef.current = plain
    setShowDraftBanner(false); pendingDraftRef.current = null
  } catch { setShowDraftBanner(false) }
}

async function discardDraft() {
  pendingDraftRef.current = null
  setShowDraftBanner(false)
  await clearLocalDraft()
  await fetch('/api/draft', { method: 'DELETE' })
}

// 防抖草稿：输入后 1000ms 保存（本地优先，服务器同步尽力而为）
function onDraftChange(text: string) {
  if (debounceRef.current) clearTimeout(debounceRef.current)
  debounceRef.current = setTimeout(() => {
    void (async () => {
      const dek = getDek()
      if (!dek || !text.trim()) return
      const { ciphertext, iv } = await encryptText(dek, text)
      const record = { ciphertext, iv, encryptionVersion: 1, updatedAt: Date.now() }
      await saveLocalDraft(record)
      void pushServerDraft(record).catch(() => {}) // 离线时静默失败，下次重试
    })()
  }, 1000)
}
```

UI 增加草稿横幅（`{showDraftBanner && (...)}`）: "发现上次未完成的日记" + 「恢复草稿」「放弃草稿」按钮。保存成功后调用 `clearLocalDraft()` 与 DELETE /api/draft（Task 8 已有占位调用，改为真实实现）。`onDraftChange` 传入 AutoTextarea 的 onChange。移除文件底部两个占位函数。

- [ ] **Step 5: 测试 + 检查 + 提交**

```bash
npm test
npm run typecheck && npm run lint && npm run build
git add -A
git commit -m "feat: 草稿系统（IndexedDB 本地加密草稿 + 服务器同步 + 冲突决策 + 恢复 UI）
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: Phase 9 — 定位

**Files:**
- Create: `lib/client/location.ts`
- Modify: `components/DiaryEditor.tsx`（接入）

- [ ] **Step 1: 定位模块**

`lib/client/location.ts`:

```ts
// 定位：失败/拒绝/超时均返回 null，绝不阻塞保存流程
export async function getPosition(timeoutMs = 3000): Promise<{ latitude: number; longitude: number; accuracy: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 60_000,
      })
    })
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }
  } catch {
    return null
  }
}
```

- [ ] **Step 2: 接入保存流程 + 首次定位权限说明**

`components/DiaryEditor.tsx` 保存函数已调用 `getPosition(2000)`（Task 8 已接线）。补充权限说明文案：首次点击保存时（若 `navigator.permissions?.query({name:'geolocation'})` 状态为 prompt）在保存按钮下方显示一行提示："保存日记时记录当前位置，仅用于记录你当时在哪里。"（一次即可，sessionStorage 标记已提示）。

- [ ] **Step 3: 检查 + 提交**

```bash
npm run typecheck && npm run lint && npm run build
git add -A
git commit -m "feat: 定位记录（失败不阻塞保存）
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 12: Phase 10 — PWA（manifest / 图标 / Service Worker）

**Files:**
- Create: `public/manifest.webmanifest`, `public/sw.js`, `components/SwRegister.tsx`, `scripts/generate-icons.js`
- Create: `public/icons/icon-180.png`, `public/icons/icon-192.png`, `public/icons/icon-512.png`
- Modify: `app/layout.tsx`

- [ ] **Step 1: 图标生成脚本（纯 Node，无图像依赖）**

`scripts/generate-icons.js`（用 zlib 生成最小 PNG，画一个圆角深色底 + 白色书页图案）:

```js
// 生成 PWA 图标：180/192/512 PNG。纯 Node 实现（zlib deflate + 手写 PNG 块）。
const zlib = require('node:zlib')
const fs = require('node:fs')
const path = require('node:path')

function crc32(buf) {
  let c, table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(size, draw) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y)
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
  const idat = zlib.deflateSync(raw)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ])
}

// 深色圆角底 + 白色圆点（书页）
function draw(size) {
  return (x, y) => {
    const cx = size / 2, cy = size / 2, r = size / 2 - size * 0.04
    const dx = x - cx, dy = y - cy
    const inCircle = Math.hypot(dx, dy) <= r
    if (!inCircle) return [0, 0, 0, 0]
    // 圆角矩形简化：内部圆形图案
    const px = x / size, py = y / size
    const isPage = px > 0.32 && px < 0.68 && py > 0.28 && py < 0.72
    const isDot = Math.hypot(x - cx, y - size * 0.5) < size * 0.05
    if (isDot) return [249, 115, 22, 255] // 橙色圆点（书页）
    if (isPage) return [255, 255, 255, 255]
    return [23, 23, 23, 255]
  }
}

const dir = path.join(__dirname, '..', 'public', 'icons')
fs.mkdirSync(dir, { recursive: true })
for (const size of [180, 192, 512]) {
  fs.writeFileSync(path.join(dir, `icon-${size}.png`), png(size, draw(size)))
  console.log(`icon-${size}.png`)
}
```

运行: `node scripts/generate-icons.js`

- [ ] **Step 2: Manifest**

`public/manifest.webmanifest`:

```json
{
  "name": "我的日记",
  "short_name": "日记",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#171717",
  "theme_color": "#171717",
  "lang": "zh-CN",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 3: Service Worker（仅静态资源缓存）**

`public/sw.js`:

```js
// Service Worker：仅缓存静态资源，绝不缓存日记密文（日记走 IndexedDB）
const CACHE = 'qo-static-v1'
const STATIC = ['/', '/manifest.webmanifest', '/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET') return
  if (url.pathname.startsWith('/api/')) return // API 永不缓存
  if (url.origin !== location.origin) return
  // 导航请求：网络优先，失败回退缓存（离线可打开）
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')))
    return
  }
  // 静态资源：缓存优先
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
    const copy = res.clone()
    caches.open(CACHE).then((c) => c.put(e.request, copy))
    return res
  })))
})
```

- [ ] **Step 4: SW 注册组件 + layout 引入**

`components/SwRegister.tsx`:

```tsx
'use client'

import { useEffect } from 'react'

export default function SwRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])
  return null
}
```

`app/layout.tsx` 引入 `<SwRegister />`（metadata 中 `manifest` 已在 Task 8 配置）。

- [ ] **Step 5: 检查 + 提交**

```bash
node scripts/generate-icons.js
npm run typecheck && npm run lint && npm run build
git add -A
git commit -m "feat: PWA（manifest/图标/Service Worker 静态缓存）
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 13: Phase 11 — 安全加固 + 安全自检

**Files:**
- Create: `middleware.ts`（安全头 + 页面路由保护）
- Create: `lib/server/security-headers.ts`
- Modify: `lib/server/env.ts`（生产日志控制）

- [ ] **Step 1: 安全响应头模块**

`lib/server/security-headers.ts`:

```ts
// CSP：生产严格，开发放宽（HMR 需要 ws:/unsafe-eval）
export function securityHeaders(): Record<string, string> {
  const dev = process.env.NODE_ENV !== 'production'
  return {
    'Content-Security-Policy': dev
      ? "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
  }
}
```

- [ ] **Step 2: middleware（页面保护 + 安全头）**

`middleware.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { securityHeaders } from './lib/server/security-headers'

const PROTECTED = ['/', '/history', '/entry']
const PUBLIC_ONLY = ['/login', '/setup']

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  for (const [k, v] of Object.entries(securityHeaders())) res.headers.set(k, v)
  const path = req.nextUrl.pathname
  const cookie = req.cookies.get('qo_session')?.value

  // 已登录访问 login/setup → 首页
  if (cookie && PUBLIC_ONLY.some((p) => path.startsWith(p))) {
    return NextResponse.redirect(new URL('/', req.url))
  }
  // 未登录访问受保护页面 → login
  if (!cookie && PROTECTED.some((p) => path === p || path.startsWith(p + '/'))) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  return res
}

export const config = {
  matcher: ['/', '/login', '/setup', '/history', '/entry/:path*', '/settings'],
}
```

（middleware 只做粗粒度 cookie 存在检查；真实认证由 API handler 的 `requireAuth` 完成。若 Next 版本以 `proxy.ts` 替代 middleware.ts，将文件改名为 `proxy.ts` 并保持内容一致。）

- [ ] **Step 3: 日志控制**

`lib/server/env.ts` 追加（用于 API 日志开关）:

```ts
export const isProd = env.NODE_ENV === 'production'
```

在 `lib/server/db/index.ts` 中配置 postgres 客户端不打印查询（默认不打印；确认无 `debug` 选项）。**全项目搜索确认**：无 `console.log` 输出 body/ciphertext/密钥。API route 中不添加 request body 日志。

- [ ] **Step 4: 设置页 + 删除所有数据**

`app/settings/page.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { clearDek, fetchSession } from '@/lib/client/session'
import { idbClearAll } from '@/lib/client/idb'

export default function SettingsPage() {
  const router = useRouter()
  const [info, setInfo] = useState<{ credentialCount: number; prfWrappers: number } | null>(null)

  useEffect(() => { void fetchSession().then((s) => setInfo({ credentialCount: s.credentialCount, prfWrappers: s.prfWrappers })) }, [])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    clearDek()
    router.replace('/login')
  }

  async function wipe() {
    if (!confirm('确定删除所有数据吗？此操作不可恢复！\n\n请先确认已保存你的恢复密钥。')) return
    await fetch('/api/admin/wipe', { method: 'POST' })
    await idbClearAll()
    clearDek()
    router.replace('/setup')
  }

  return (
    <main className="min-h-dvh px-5 safe-pt safe-pb">
      <header className="flex items-center justify-between py-3">
        <Link href="/" className="text-neutral-400">‹ 返回</Link>
        <h1 className="text-lg font-semibold">设置</h1>
        <span className="w-8" />
      </header>
      <ul className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
        <li className="flex items-center justify-between py-4">
          <span className="text-neutral-800 dark:text-neutral-200">Passkey</span>
          <span className="text-sm text-neutral-400">已启用（{info?.credentialCount ?? 0} 个）</span>
        </li>
        <li className="py-4"><Link href="/settings/passkey" className="text-neutral-800 dark:text-neutral-200">注册新的 Passkey</Link></li>
        <li className="py-4"><Link href="/settings/recovery" className="text-neutral-800 dark:text-neutral-200">导出恢复密钥</Link></li>
        <li className="py-4"><Link href="/settings/recovery" className="text-neutral-800 dark:text-neutral-200">重新生成恢复密钥</Link></li>
        <li className="py-4"><button onClick={() => void logout()} className="text-neutral-800 dark:text-neutral-200">退出登录</button></li>
        <li className="py-4"><button onClick={() => void wipe()} className="text-red-500">删除所有数据</button></li>
        <li className="py-4 text-sm text-neutral-400">关于：端到端加密私人日记 · v0.1</li>
      </ul>
    </main>
  )
}
```

- [ ] **Step 5: 新增 wipe 与 passkey 注册 API**

`app/api/admin/wipe/route.ts`（清空全部表 + 登出）:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { credentials, diaryEntries, drafts, keyWrappers } from '@/lib/server/db/schema'
import { requireAuth } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/ratelimit'

export async function POST(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!rateLimit('wipe', 3, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  await db.delete(credentials)
  await db.delete(keyWrappers)
  await db.delete(diaryEntries)
  await db.delete(drafts)
  const res = NextResponse.json({ ok: true })
  res.cookies.set('qo_session', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
```

`app/settings/passkey/page.tsx`（注册新 Passkey，复用 setup 逻辑的注册+wrap 部分，去掉 recovery 生成）：

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { registerPasskey, authenticatePasskey } from '@/lib/client/webauthn'
import { getDek } from '@/lib/client/session'
import { derivePrfKek } from '@/lib/client/crypto/setup'
import { prfEvalB64 } from '@/lib/client/crypto/prf'

export default function AddPasskeyPage() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    setBusy(true); setError(null)
    try {
      // 1. 用现有 DEK（内存中，页面保护确保已解锁）与新 passkey 绑定
      const dek = getDek()
      if (!dek) { router.replace('/login'); return }
      const prfEval = crypto.getRandomValues(new Uint8Array(32))
      const optsRes = await fetch('/api/auth/register/options')
      const { token, options } = await optsRes.json()
      const { registration, prfEnabled } = await registerPasskey(options, prfEval)
      const regResp = await fetch('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, registration }),
      })
      if (!regResp.ok) throw new Error('注册失败')
      if (!prfEnabled) throw new Error('此设备不支持 PRF，无法添加 Passkey 解锁')
      // 2. 认证获取 PRF 输出 → 包裹 DEK
      const loginRes = await fetch('/api/auth/login/options')
      const loginOpts = await loginRes.json()
      const { assertion, prfResult } = await authenticatePasskey(loginOpts.options, prfEvalB64(prfEval))
      const authResp = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: loginOpts.token, assertion }),
      })
      if (!authResp.ok || !prfResult) throw new Error('PRF 验证失败')
      const kek = await derivePrfKek(prfResult, prfEvalB64(prfEval))
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dek))
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw))
      const combined = new Uint8Array(iv.length + cipher.length)
      combined.set(iv, 0); combined.set(cipher, iv.length)
      const wrapRes = await fetch('/api/keys/wrappers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wrapperType: 'passkey_prf',
          credentialId: (registration as { id?: string }).id ?? '',
          encryptedDek: btoa(String.fromCharCode(...combined)),
          salt: prfEvalB64(prfEval),
          encryptionVersion: 1,
        }),
      })
      if (!wrapRes.ok) throw new Error('保存包装失败')
      router.replace('/settings')
    } catch (e) {
      setError(e instanceof Error ? e.message : '添加失败')
    } finally { setBusy(false) }
  }

  return (
    <main className="min-h-dvh px-5 safe-pt safe-pb">
      <header className="flex items-center justify-between py-3">
        <Link href="/settings" className="text-neutral-400">‹ 设置</Link>
        <h1 className="text-lg font-semibold">添加 Passkey</h1>
        <span className="w-8" />
      </header>
      <p className="text-sm text-neutral-500">新增 Passkey 后将可用它（Face ID）解锁同一份日记。</p>
      <button onClick={add} disabled={busy} className="mt-6 w-full rounded-2xl bg-neutral-900 py-4 font-medium text-white disabled:opacity-50">
        {busy ? '添加中…' : '注册新的 Passkey'}
      </button>
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
    </main>
  )
}
```

**问题**：`getExistingDekFromMemory`——注册新 passkey 时 DEK 必须在内存中（刚解锁）。但 PRF 输出对新 passkey 是**新密钥**，用新 PRF(S2) 包裹同一 DEK 即可（老 passkey 不受影响）。⚠️ 但如果新 passkey 也生成自己的 S2，其 wrapper 独立。OK。唯一注意：`getDek()` 可能为 null（未解锁）——页面保护已确保解锁后才可访问（settings 受 middleware 保护 + getDek 检查）。

`app/settings/recovery/page.tsx`（导出/重新生成 Recovery Key——需要输入当前 recovery key 验证）:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fetchWrappers } from '@/lib/client/session'
import { unwrapWithRecoveryKey } from '@/lib/client/crypto/setup'
import { generateRecoveryKey, sha256Hex } from '@/lib/client/crypto/recovery-key'
import { createWrappedDek } from '@/lib/client/crypto/setup'

export default function RecoverySettingsPage() {
  const router = useRouter()
  const [currentKey, setCurrentKey] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'export' | 'regenerate'>('export')

  async function verifyAndProceed() {
    setBusy(true); setError(null)
    try {
      const wrappers = await fetchWrappers()
      const rec = wrappers.find((w) => w.wrapperType === 'recovery')
      if (!rec) throw new Error('未找到恢复包装')
      const dek = await unwrapWithRecoveryKey(rec.encryptedDek, rec.salt, currentKey.trim())
      if (mode === 'export') {
        // 已通过验证，显示当前密钥
        setNewKey(currentKey.trim())
      } else {
        // 生成新 key，用新 key 包裹 DEK 并更新服务器
        const next = generateRecoveryKey()
        const saltR = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
        const wrapped = await createWrappedDek(dek, new TextEncoder().encode(next), 'recovery-kek', saltR)
        const hash = await sha256Hex(next)
        const up = await fetch('/api/keys/wrappers/recovery', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ encryptedDek: wrapped.encryptedDek, salt: wrapped.salt, encryptionVersion: 1, recoveryKeyHash: hash }),
        })
        if (!up.ok) throw new Error('更新失败')
        setNewKey(next)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '验证失败（当前恢复密钥不正确？）')
    } finally { setBusy(false) }
  }

  return (
    <main className="min-h-dvh px-5 safe-pt safe-pb">
      <header className="flex items-center justify-between py-3">
        <Link href="/settings" className="text-neutral-400">‹ 设置</Link>
        <h1 className="text-lg font-semibold">{mode === 'export' ? '导出恢复密钥' : '重新生成恢复密钥'}</h1>
        <span className="w-8" />
      </header>
      <p className="text-sm text-neutral-500">先输入当前恢复密钥验证身份</p>
      <input value={currentKey} onChange={(e) => setCurrentKey(e.target.value)} placeholder="当前恢复密钥"
        className="mt-4 w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-base outline-none dark:border-neutral-700 dark:bg-neutral-900" />
      <button onClick={() => void verifyAndProceed()} disabled={busy || !currentKey.trim()}
        className="mt-4 w-full rounded-2xl bg-neutral-900 py-4 font-medium text-white disabled:opacity-50">
        {busy ? '验证中…' : '验证'}
      </button>
      {newKey && (
        <div className="mt-6">
          <p className="text-sm text-neutral-500">请立即保存，此密钥仅显示一次：</p>
          <code className="mt-2 block break-all rounded-xl bg-neutral-100 px-4 py-3 text-sm dark:bg-neutral-800">{newKey}</code>
          <button onClick={() => void navigator.clipboard?.writeText(newKey)} className="mt-2 text-sm text-neutral-500 underline">复制</button>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
    </main>
  )
}
```

新增 `app/api/keys/wrappers/recovery/route.ts`（PUT 更新 recovery wrapper）:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { keyWrappers } from '@/lib/server/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { requireAuth } from '@/lib/server/auth'
import { z } from 'zod'

const schema = z.object({
  encryptedDek: z.string().min(1).max(2048),
  salt: z.string().min(1).max(256),
  encryptionVersion: z.number().int().min(1).max(10).default(1),
  recoveryKeyHash: z.string().length(64),
})

export async function PUT(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = schema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const { encryptedDek, salt, encryptionVersion, recoveryKeyHash } = body.data
  await db.update(keyWrappers)
    .set({ encryptedDek, salt, encryptionVersion, recoveryKeyHash })
    .where(and(eq(keyWrappers.wrapperType, 'recovery'), isNull(keyWrappers.credentialId)))
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 6: 安全自检（文档第 37 节 15 项）**

逐项检查并记录到 README「安全说明」：
1. 数据库无日记明文 ✅（schema 仅 ciphertext/iv）
2. API 无明文返回 ✅（无 decrypt 端点）
3. 客户端加密后上传 ✅
4. DEK 不进服务器 ✅（仅 wrapper 密文）
5. PRF 输出不进日志 ✅（无日志）
6. Recovery Key 不进服务器 —— ⚠️ 仅存 SHA-256 哈希（不可逆，256-bit 熵不可爆破）
7. localStorage 无明文 ✅（只有 IndexedDB 密文草稿）
8. Cookie 无密钥 ✅（仅 session JWT）
9. XSS ✅（无 dangerouslySetInnerHTML）
10. 未登录 401 ✅
11. IDOR ✅（单用户 + uuid 校验）
12. 删除需认证 ✅
13. 日志无 body ✅
14. 第三方脚本 ✅（零第三方）
15. 库泄露仅密文 ✅

- [ ] **Step 7: 检查 + 提交**

```bash
npm run typecheck && npm run lint && npm run build
git add -A
git commit -m "feat: 安全加固（CSP/安全头/路由保护/wipe/恢复密钥管理）+ 设置页
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 14: Phase 12 — 测试补全 + 手动清单

**Files:**
- Create: `tests/validation.test.ts`, `tests/api-protection.test.ts`
- Create: `docs/MANUAL_TESTING.md`

- [ ] **Step 1: validation 单元测试**

`tests/validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { diaryCreateSchema, diaryUpdateSchema, draftPutSchema, wrapperSchema } from '../lib/server/validation'

describe('zod 校验', () => {
  it('接受合法日记创建', () => {
    expect(diaryCreateSchema.safeParse({ ciphertext: 'x', iv: 'y', encryptionVersion: 1, latitude: 31.2 }).success).toBe(true)
  })
  it('拒绝客户端伪造时间/id', () => {
    expect(diaryCreateSchema.safeParse({ ciphertext: 'x', iv: 'y', id: 'abc', createdAt: '2026' }).success).toBe(false)
  })
  it('拒绝超长密文', () => {
    expect(diaryCreateSchema.safeParse({ ciphertext: 'x'.repeat(300_001), iv: 'y' }).success).toBe(false)
  })
  it('拒绝非法经纬度', () => {
    expect(diaryCreateSchema.safeParse({ ciphertext: 'x', iv: 'y', latitude: 100 }).success).toBe(false)
  })
  it('wrapper 拒绝未知字段', () => {
    expect(wrapperSchema.safeParse({ wrapperType: 'passkey_prf', credentialId: 'c', encryptedDek: 'e', salt: 's', recoveryKeyHash: 'h' }).success).toBe(false)
  })
  it('draft 拒绝 location', () => {
    expect(draftPutSchema.safeParse({ ciphertext: 'x', iv: 'y', latitude: 1 }).success).toBe(false)
  })
})
```

- [ ] **Step 2: API 保护测试（直调 route handler）**

`tests/api-protection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { POST as diaryPost } from '../app/api/diary/route'

describe('diary API 认证保护', () => {
  it('无 cookie → 401', async () => {
    const res = await diaryPost(new Request('http://localhost/api/diary', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ciphertext: 'x', iv: 'y' }),
    }))
    expect(res.status).toBe(401)
  })
})
```

（该测试验证认证中间件接线；后续可扩展。WebAuthn 全流程无法在 node 环境模拟——由 `docs/MANUAL_TESTING.md` 手动清单覆盖。）

- [ ] **Step 3: 手动测试清单**

`docs/MANUAL_TESTING.md`：按文档第 36 节场景编写双平台清单（iPhone Safari + Edge），每项带"步骤/期望"：
- WebAuthn：首次注册、登录、错误 credential、未认证 API、登出、多 credential
- E2EE：加密/解密/刷新/登出/清缓存/恢复 key/错误 key/篡改密文/篡改 IV
- Diary：新建/编辑/删除/多行/Emoji/中文/长文本/空白/断网/恢复
- Draft：自动保存/刷新恢复/关浏览器恢复/离线恢复/冲突
- Geolocation：允许/拒绝/无法获取/低精度
- PWA：添加主屏幕/独立启动/图标/深色/safe-area/键盘/横竖屏

- [ ] **Step 4: 检查 + 提交**

```bash
npm test
npm run typecheck && npm run lint && npm run build
git add -A
git commit -m "test: 校验与 API 保护测试 + 手动测试清单
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 15: Phase 13 — 部署文档 + README + .env.example

**Files:**
- Create: `README.md`, `docs/deploy/ECS-DEPLOY.md`, `.env.example`
- Create: `docs/deploy/nginx.conf.example`, `docs/deploy/quiet-orbit.service.example`

- [ ] **Step 1: .env.example**

`.env.example`:

```
# 数据库（PostgreSQL 连接串）
DATABASE_URL=postgres://user:password@localhost:5432/quiet_orbit
# WebAuthn RP 信息（正式域名）
WEBAUTHN_RP_ID=diary.example.com
WEBAUTHN_RP_NAME=我的日记
WEBAUTHN_ORIGIN=https://diary.example.com
# 会话签名密钥（openssl rand -base64 48）
SESSION_SECRET=please-generate-a-random-48-byte-secret
# 加密版本（当前为 1）
RECOVERY_KEY_VERSION=1
```

- [ ] **Step 2: README.md**

包含：项目简介、功能清单、架构图（E2EE 数据流）、本地开发（安装/环境变量/migration/运行）、测试命令、安全说明（E2EE 边界声明："E2EE 能防止数据库泄露，但无法完全抵御已经被攻陷的客户端/前端代码"）、**首次初始化 Passkey 操作说明**、**iPhone 添加主屏幕说明**、**Recovery Key 保存建议**、**换 iPhone 恢复流程**、生产部署指引（链接 ECS-DEPLOY.md）、数据库备份说明、验收清单。

- [ ] **Step 3: ECS 部署文档**

`docs/deploy/ECS-DEPLOY.md`：Node.js 版本（LTS ≥ 20）、PostgreSQL 安装与建库、npm/pnpm、环境变量、migration 执行、`npm run build`、PM2 配置（或 systemd unit 示例）、Nginx 反向代理示例（HTTPS 443、HTTP/2、安全头、CSP 已由应用注入）、备份策略（pg_dump 定时 + 说明备份仅含密文）、更新流程、恢复流程。架构图：

```
Internet → Nginx(:443, TLS) → Next.js(:3000) → PostgreSQL(:5432)
```

`docs/deploy/quiet-orbit.service.example`（systemd）与 `docs/deploy/nginx.conf.example`（Nginx server 块）完整示例。

- [ ] **Step 4: 检查 + 提交**

```bash
npm run typecheck && npm run lint && npm run build && npm test
git add -A
git commit -m "docs: README + ECS 部署说明 + .env.example
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 16: 最终验收

- [ ] **Step 1: 全量检查**

```bash
npm run lint && npm run typecheck && npm run build && npm test
```

Expected: 全部通过，无错误。

- [ ] **Step 2: 对照验收清单（文档第 1491–1521 行 25 项）**

逐项核对代码实现，标注 ✅/手动验证项（真机 iPhone Safari 验证项列入手动清单）。

- [ ] **Step 3: 最终提交**

```bash
git add -A
git commit -m "chore: 项目完成（最终验收）
Co-Authored-By: Claude <noreply@anthropic.com>"
git log --oneline
```

- [ ] **Step 4: 向用户交付说明**

包含：初始化 Passkey 操作方法、iPhone 添加主屏幕方法、Recovery Key 保存方法、换 iPhone 恢复方法、已知兼容性边界（Edge PRF 降级）、真机验证清单链接。
