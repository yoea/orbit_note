# 图片附件功能 · 实现方案（设计文档，尚未写码）

> 状态：**设计已定，未实现**。2026-10-02 产出。
> 决策：存储后端 = **阿里云 OSS**（同地域，走内网）；第一版目标 = 完整可用版。
> 相关：`docs/PROJECT_OVERVIEW.md`（代码地图，改路由/接口要同步它）、`.workbuddy/memory/MEMORY.md`（项目铁律）。
> `components/Markdown.tsx` 顶部已预埋本设计的方向：「图片故意不渲染 `<img>`……等将来做『图片附件』（客户端加密 + 本地 blob）时再换成真实渲染」——本方案就是把这句话做完。

---

## 1. 目标与非目标

**目标**

1. 日记正文可插图片；查看页排版规整、点开可放大；列表页有缩略图提示。
2. **图片与正文同为 E2EE**：原图永不离开浏览器，服务端与 OSS 只存密文。
3. 离线可看已缓存的图（沿用既有离线不变量）。
4. 导出 zip 时图片随行（Day One 兼容格式）。
5. 视觉与操作便利：工具栏 / 拖拽 / 粘贴三条插入路径，插入即见（乐观 UI）。

**非目标（本期明确不做）**

- 不做视频、音频、PDF、动图特判（动图按静态首帧处理即可）。
- 不做服务端图片处理（缩略图/裁剪）——密文态下 OSS 的 `x-oss-process` 不可用。
- 不做 OCR / 识图 / 搜索图片内容。
- 不做「用系统相机直接拍摄」的自定义相机页（`<input capture>` 已能调起相机，够用）。
- 不做 Web Share Target（分享到本 App），二期再说。

---

## 2. 不可破的约束（现有铁律，直接影响实现）

| 约束 | 出处 | 对本功能的要求 |
|---|---|---|
| 正文 E2EE，DEK 只在浏览器内存 | 项目核心 | 图片复用**同一个 DEK**（AES-256-GCM），每张独立 12 字节 IV |
| 零 `dangerouslySetInnerHTML` | XSS 边界 | 图片只经 React 属性渲染，不拼 HTML 字符串 |
| 零 `console` 输出 | 项目约定 | 调试信息一律吞掉或走 `Temp/` 脚本 |
| 生产 CSP 严格 | `lib/server/security-headers.ts` | **`img-src` 必须加 `blob:`**，否则解密后的图永不显示 |
| 新增路由双登记 | `proxy.ts` matcher + `lib/server/proxy-guard.ts` protectedPaths | 三个新 API 路由两边都要登记，守卫 `tests/proxy-matcher-coverage.test.ts` 会红 |
| 迁移手工、多数无 `IF NOT EXISTS` | 发版铁律 | 新表 SQL 只能跑一次，先查 `information_schema` |
| 离线可读性 = 本地缓存完整性 | 2026-09-30 事故 | 「列表里能看见的 ⇒ 本地必已有密文」要延伸到附件 |
| iOS 视口 | 真机事故 | Lightbox 吃 `body.app-height` / `100dvh` / `.pb-safe`；blob URL 必须 `revokeObjectURL` |
| 1.8G 内存的弱服务器 | 2026-09-29 IO 事故 | **绝不在 Node 侧缓冲整个文件/整批**；转发必须流式 |
| 导出 zip 是 STORE + 内存拼接 | `lib/client/zip.ts` | 图片进 zip 会显著抬高峰值内存 ⇒ 见 §9 的体积上限与分片评估 |
| `Permissions-Policy: camera=()` | `security-headers.ts` | `<input type="file" accept="image/*" capture>` **不受**该策略限制，可正常调起相机；若将来要 `getUserMedia` 才需改策略 |

---

## 3. 架构总览

```
浏览器（唯一接触明文的地方）
  选图 / 拖拽 / 粘贴
    └─ 3a. 解码 + 重编码（canvas）→ 主图（≤1600px, WebP/JPEG）+ 缩略图（256px）
         ★ canvas 重绘天然丢弃 EXIF/GPS；HEIC 也因此得以显示（浏览器本来就解不了 HEIC）
    └─ 3b. AES-GCM 加密（复用 DEK，各自独立 IV）→ 密文字节
    └─ 3c. 立即写入 IndexedDB（密文）+ 正文插入占位引用 + 立刻显示本机图（乐观 UI）
    └─ 3d. 后台队列上传密文（离线时进既有离线队列语义）
                    ↓ HTTPS（只传密文 + 随机 key）
服务端（不接触明文）
  鉴权（requireAuth）→ 转发 PutObject（内网 endpoint）→ attachments 元数据入库
                    ↓
OSS 私有桶：att/<uuid>  ← 密文 + 密文缩略图，仅此两类对象
```

**读取**：浏览器请求 `/api/attachments/:id/raw`（自带鉴权）→ 服务端 `GetObject` 并**流式**转发 → 浏览器 AES-GCM 解密 → `URL.createObjectURL(blob)` → `<img src=blob:>` → 渲染后 `revokeObjectURL`。

**为什么不让浏览器直连 OSS 签名 URL**（备选方案 B，见 §6.3）：技术上可行（服务端只签 URL），但要①CSP 放行 OSS 域名 ②签名 URL 一旦泄漏即长期有效（除非短 TTL）③多一个域名进入攻击面。方案 A（服务端中转）的代价是吃 ECS 已有公网带宽，而**固定带宽已付、外网流出边际成本为 0**，且内容可 `immutable` 强缓存 ⇒ 二级查看零流量。默认选 A；若将来图片量大到带宽成为瓶颈，再切 B（只改一处配置开关）。

---

## 4. 数据模型

### 4.1 新表 `attachments`（migration `0015_attachments.sql`）

```sql
CREATE TABLE attachments (
  id            uuid PRIMARY KEY,                    -- 客户端生成的 uuid v4（见 §4.3）
  entry_id      uuid REFERENCES diary_entries(id) ON DELETE CASCADE,
  object_key    text NOT NULL UNIQUE,                -- 'att/<uuid>'，绝不按日期建目录
  iv            text NOT NULL,                       -- base64，12 字节（与正文同约定）
  width         integer NOT NULL,
  height        integer NOT NULL,
  bytes         integer NOT NULL,                    -- 主图密文字节
  thumb_key     text,                                -- 缩略图密文（'att/<uuid>-t'）
  thumb_iv      text,
  thumb_bytes   integer,
  mime          text NOT NULL,                       -- 'image/webp' | 'image/jpeg'（仅决定 blob type 与导出后缀）
  status        text NOT NULL DEFAULT 'pending',     -- 'pending' | 'ready'（服务端只存 ready，pending 是客户端态）
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attachments_status_check CHECK (status IN ('pending','ready')),
  CONSTRAINT attachments_thumb_pair_check CHECK ((thumb_key IS NULL) = (thumb_iv IS NULL))
);
CREATE INDEX attachments_entry_id_idx ON attachments(entry_id);
CREATE INDEX attachments_created_at_idx ON attachments(created_at);   -- 孤儿 GC 扫描用
```

**刻意不存的东西**（每一条都是隐私决策）：

- 不存图片密文本体（只在 OSS 与 IndexedDB）——避免数据库与备份膨胀。
- 不存原始文件名、不存 EXIF、不存任何明文图片信息。
- 不存宽高以外的任何图片元数据（宽高是渲染必需，且泄漏价值极低）。

### 4.2 正文引用协议

正文里写：

```markdown
![optional 描述](qo-attachment://8f1c…-…)
```

- 只有这个协议会被渲染成真实图片；**其它任何 img 维持现有的占位文案**（`Markdown.tsx` 现有行为不动，那条「外链图片等于把阅读信号送给第三方图床」的立场保留）。
- **★ 实现坑（必读）**：react-markdown 默认的 `urlTransform`（mdast-util-to-hast `defaultUrlTransform`）只放行 `http/https/mailto/tel/irc/ircs/xmpp` 与相对路径，**自定义协议会被清空**。必须显式传 `urlTransform={(url, key, node) => (url.startsWith('qo-attachment://') ? url : defaultUrlTransform(url, key, node))}`。不传 ⇒ 图片引用被静默改写成空 `src`，且**不会有任何报错**。
- `alt` 文本缺省为空 ⇒ 渲染时用序号占位（如「图 3」），不编造描述。
- 图片在正文里是**块级独占**：`img` 前后若有文字，渲染时各留一个段间距；连续图片自动成组（§7 排版规则按「连续出现的图片组」判定，而不是按段落）。

### 4.3 id 生成与幂等

- 附件 id = 客户端 `crypto.randomUUID()`（**v4**）。注意与导入幂等用的 **UUIDv5**（`lib/client/uuid-v5.ts`）是两回事，不要混用：附件 id 必须在**上传重试之间保持不变**，所以不能每次重试重新生成。
- 元数据上报用 **upsert**（`onConflictDoNothing` + 之后按需 patch），重复上报天然幂等。
- 删除：删日记时 `ON DELETE CASCADE` 清元数据行，**OSS 对象删除走补偿**（事务外删除，失败记日志待清理任务重试）。孤儿对象（正文里已无引用）由 GC 兜底：服务端每日扫 `created_at` 早于 7 天且不在任何正文引用中的行，删对象 + 删行。**不做「引用计数」**，改为「正文引用集合」判定，避免计数漂移。

---

## 5. 客户端实现

### 5.1 加密 API 扩展（`lib/client/crypto/encryption.ts`）

现有只有文本函数（密文/IV 都走 base64）。图片要**二进制**接口，且**不要对图片密文做 base64**（会凭空膨胀 33%）：

```ts
export async function encryptBytes(key: CryptoKey, plain: Uint8Array): Promise<{ ciphertext: ArrayBuffer; iv: string }>
export async function decryptBytes(key: CryptoKey, ciphertext: ArrayBuffer, iv: string): Promise<ArrayBuffer>
```

- IV 仍为 12 字节 CSPRNG、仍以 base64 存（与正文同约定，便于排障对账）。
- TS 注意：`crypto.subtle` 的 BufferSource 类型在新版 TS 里是 `Uint8Array<ArrayBuffer>` 而非 `ArrayBufferLike`（现有 `randomBytes` 已经这样标注），直接沿用其写法。
- **不改** `encryptText` / `decryptText` 的任何签名与行为（有守卫钉着）。

### 5.2 重编码（`lib/client/image-encode.ts`，新文件）

| 参数 | 取值 | 理由 |
|---|---|---|
| 解码 | `createImageBitmap(file, { imageOrientation: 'from-image' })` | 处理 EXIF 方向；失败时回退 `<img>` + `URL.createObjectURL` |
| 主图长边 | **1600px**（原图更小则不放大） | 手机屏足够；2000px 体积翻倍而肉眼几乎无差 |
| 主图格式 | `image/webp` q≈0.82，`toBlob('image/webp')` 返回 null 时回退 `image/jpeg` q0.85 | WebP 通常比 JPEG 小 25~35%；Safari 编码支持存在版本差异，**必须有回退分支** |
| 缩略图长边 | 256px，同格式 | 列表 42~64px 显示，256px 够 2x 屏 |
| 元数据 | 画布 `toBlob` 产物**不含 EXIF** | ★ 顺带彻底丢弃 GPS/机型/拍摄时间 |
| 尺寸上限 | 输入 > 40MB 或像素 > 8000×8000 直接拒绝并提示 | 防 OOM（iOS Safari 解码大图会崩） |

- 多选时**串行**处理（并行解码会瞬时吃掉几百 MB）。
- 每张图处理完立即进缓存与队列，**不等全部处理完**（用户感知：选完 5 张，第 1 张就已经能用）。

### 5.3 本地缓存（`lib/client/idb.ts` 现有单 store 泛型 KV 可直接用）

- key：`att:<uuid>` → `{ ciphertext: ArrayBuffer, iv, thumbCiphertext?, thumbIv?, mime, width, height, updatedAt }`（**存密文不存明文**，与 `offline:entries` 同一条纪律）。
- 写缓存一律 `await`（沿用「列表里能看见的 ⇒ 本地必已有」不变量）。
- 配额兜底：捕获 `QuotaExceededError` ⇒ 按 LRU（`updatedAt` 最小）淘汰**除当前打开条目以外**的附件密文，并 `Toast` 提示「空间不足，已清理旧图片缓存」。**绝不静默失败**。
- 清理：删除日记时连带删本地附件缓存；`WipeDataAction`（「删除所有数据」）必须遍历清理 —— 这是守卫要盯的点。

### 5.4 上传队列

复用既有离线队列语义（`lib/client/offline.ts` 的 `QUEUE_EVENT` / `withEntriesLock` 同款纪律）：

1. 插入图片 → 本地立刻可用 + 排入附件上传队列。
2. 队列逐个上传（`PUT /api/attachments/:id/blob` 带密文二进制），成功后 `POST /api/attachments` 登记元数据（id/宽高/iv/大小/mime）。
3. 失败（离线/5xx）重试，**指数退避**，最多 N 次后置为「待重试」并在编辑器里显示一个小的状态点（不上浮为错误弹窗）。
4. **附件上传失败绝不影响正文保存**——正文与附件是两条独立链路（§4 已保证正文密文不含图片字节）。这是本方案最重要的解耦点。

---

## 6. 服务端与 OSS

### 6.1 新增路由（三条，全部要双登记）

| 路由 | 方法 | 作用 | 鉴权 |
|---|---|---|---|
| `/api/attachments` | POST | 登记/更新元数据（幂等 upsert） | requireAuth + zod |
| `/api/attachments/:id/blob` | PUT / GET | 上传密文 / 取回密文（流式转发） | requireAuth；GET 需校验归属或公开性（本项目单用户，仍校验条目存在） |
| `/api/attachments/:id/thumb` | GET | 取回缩略图密文 | 同上 |

登记处：`proxy.ts` 的 `config.matcher`（**必须内联字面量**，SWC/Turbopack 静态求值不支持常量引用）+ `lib/server/proxy-guard.ts` 的 `protectedPaths`。守卫测试 `tests/proxy-matcher-coverage.test.ts` 会盯。

- **限流**：复用 `lib/server/ratelimit.ts`（单实例内存滑动窗口，key 必须静态），blob 端点用 `/api/attachments` 静态 key，不要把 id 拼进 key。
- **上传体积上限**：请求体按 `content-length` 硬拒（主图 ≤ 8MB 密文、缩略图 ≤ 256KB），并在 Zod 里再校验一次。

### 6.2 OSS 侧配置

| 项 | 值 | 理由 |
|---|---|---|
| 地域 | **与 ECS 同地域**（ECS 在上海 → 华东1 杭州 / 华东2 上海） | 内网 endpoint 的流入流出**免费**；跨地域 0.5 元/GB |
| Bucket ACL | **私有** | 公开读会直接毁掉整个隐私前提 |
| 访问凭据 | **ECS 实例 RAM 角色**（首选，走 metadata）或最小权限 AK | 客户端与仓库里都不出现密钥 |
| RAM 策略 | 仅 `oss:PutObject` / `oss:GetObject` / `oss:DeleteObject`，Resource 限定 `bucket/att/*` | **不给 `oss:ListBucket`**：能列出对象就等于拿到「有哪些图、多大、何时」的目录 |
| 防盗链 | 留空（我们走服务端中转，不直连） | 留空即可，避免误配把自己挡在外面 |
| 生命周期 | 不用（GC 由应用做，见 §4.3） | OSS 生命周期规则删了对象，元数据行会变成有行无对象 |
| 版本控制 / 跨区复制 | **关闭** | 密文多一份副本 = 多一份泄漏面与成本 |

依赖：Node 侧用官方 `ali-oss` SDK（只需 PutObject/GetObject/DeleteObject）。注意它会进 standalone 产物（§2 教训：Turbopack 会追踪 server 依赖），部署后核对产物体积与 `BUILD_ID`；`deploy.sh` 打印的体积从当前 ~8.3MB 上涨属正常。

### 6.3 取图方式（A/B 开关）

- **A（默认）**：浏览器 → `/api/attachments/:id/blob` → 服务端 `GetObject` **流式 pipe** → 浏览器解密。响应头 `Cache-Control: private, max-age=31536000, immutable`（密文内容不变，URL 稳定）。
  - **必须流式**：1.8G 内存的机器上把 350KB 单张读进 Buffer 尚可，但**绝不允许**缓冲批量或整包。
- **B（备选）**：服务端签发 60s 短时效签名 URL，浏览器直连 OSS。需 CSP 放行 OSS 域名。适合将来图片量压过服务器带宽时切换，改动面 = 一个配置分支 + CSP 一行。
- 两种模式**都要求服务端不做图片处理**。缩略图必须客户端生成好再上传（§5.2）。

### 6.4 环境变量（新增到服务器 `.env`，属生产配置唯一真源）

```
OSS_REGION=cn-shanghai          # 或 cn-hangzhou，须与 ECS 同地域
OSS_BUCKET=quiet-orbit-attach
OSS_URL_TTL_SECONDS=60          # 仅 B 模式用到
# 凭据：优先用 RAM 角色，此时下面两行不填
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
```

- 与既有铁律一致：这些值**只写进服务器 `.env`**，绝不进仓库、绝不进 `NEXT_PUBLIC_*`。
- `deploy.sh` 的 `.env` 保护（[5/8] 清产物 + `update.sh` md5 断言）**已覆盖**新增键，无需改动；但 `update.sh` 的 WebAuthn 运行期校验段建议顺带加一条「OSS 凭据可解析」的检查（沿用「向运行中的进程提问」的做法）。

---

## 7. 渲染与排版规格

**核心原则：数量自适应，全站只有这一套规则。** 三种尺寸混排是「显乱」的主因。

| 组内图片数 | 排版 | 细节 |
|---|---|---|
| 1 | 铺满内容宽度，按原比例 | 圆角 12px；**高度封顶 60dvh**（超长图不至于吃掉整屏）；**不 `object-fit: cover`**（会切掉人脸） |
| 2 | 一行二等分，间隙 2px | 固定 1:1 裁切可接受？不——用 `aspect-ratio: 1` + `cover` 只在这一档使用（两图并排时轻微裁切可接受） |
| 3 | 一行三等分，间隙 2px | 同上 |
| ≥4 | **三列宫格 + 右下角「+N」** | 宫格最多显示 9 张，其余折进「+N」；点任一张进 Lightbox 从该张开始浏览 |

- **占位防跳版**：宽高在附件元数据里（明文），渲染时 `aspect-ratio` + `background` 占位，解密完成后淡入（`transition-opacity`，**不要用 transition 简写**——项目铁律：简写会把 backdrop-filter 拉进过渡属性）。
- **Lightbox**：全屏黑底（`#0a0a0a`）、`100dvh`、`.pb-safe`；手势：纵向拖拽下拉关闭、双击缩放、左右滑动切换；关闭时 `revokeObjectURL` 全部对象 URL。**必须处理「关闭时仍在解密」** ⇒ 用 `aliveRef` 语义（与打开次数那次的坑同源：StrictMode 假卸载 + 去重 ref 会让状态永远不复位）。
- **列表行**：右侧最多 3 张 42×42 缩略图（3px 间隙），超出显示「+N」蒙层；整行仍是 `<Link>`，**缩略图不可点**（沿用星图标的既有纪律）。
- **无图 / 失败 / 解密中**三态必须可区分（沿用筛选面板空态的教训：空态要区分「正在解密 / 真的没有 / 加载失败」）。附件加载失败给「重新加载」而不是空白。
- 编辑态：图片以缩略卡片插入在光标处，选中可删除（删除只移除引用，附件进孤儿 GC，**不立即删 OSS 对象**——防误删与撤销）。

---

## 8. 离线与一致性

1. 附件缓存与 `offline:entries` 同生命周期：写入 `await`、删除同步清、孤儿清理。
2. 离线时：已缓存 ⇒ 正常显示；未缓存 ⇒ 占位 + 「离线不可用」提示（**不是空白**）。
3. 上传队列与既有离线队列**分离但共享状态机**（避免一个失败拖垮另一个）。
4. `qo-offline-cache` 偏好关闭时：不缓存附件明文/密文，列表缩略图退化为占位图标。**这条要显式实现**，否则用户关了缓存却仍在本地存图，是隐私预期不一致。
5. 多标签页：`BroadcastChannel`/storage 事件通知「某附件已解密，可复用 blob」——避免两标签页各解一次（内存翻倍，iOS 上会 OOM）。复用窗口 5 分钟。

---

## 9. 导出 / 导入

**导出（Day One 兼容）**

- `JournalFile` 增加 `photos` 数组；zip 内新增 `photos/<uuid>.<ext>`，内容为**解密后的原始图片字节**（导出文件归用户自己持有，解密是预期行为）。
- 逐字段台账要扩：新增 `attachments` 侧的导出覆盖清单（`ENTRY_COLUMN_COVERAGE` 的对账思路同样适用——**加列忘了导出即红**这条铁律要延续到新表）。
- **★ 内存风险**：`lib/client/zip.ts` 是 STORE + 内存 `concat` 拼接。100 张 350KB 图 ⇒ 约 35MB 图片 + zip 缓冲，峰值内存可能是它的 2~3 倍。本期做法：
  1. zip 支持「按需添加、边写边算 CRC」，把 `concat` 改成分片数组 + 最终一次 `Blob` 组合（改动小、峰值降一截）；
  2. 超过阈值（建议 200MB 原始图片总量）时**明确提示**并提供「只导出文字」选项，不静默失败也不静默截断。
- 导出格式版本：`FORMAT_VERSION = 5 → 6`（解析器不看版本号，但台账与文档要同步）。

**导入**

- 现状 `parseJournal` 只统计 `photos` 计数，不取内容。本期**保持不变**（Day One 的图片在 zip 外，本项目没有明文来源可导入）。
- 二期可选：支持导入包内图片 ⇒ 客户端加密后上传 OSS。**这需要服务端有 OSS 写权限（已有）**，技术上可行，但会把导入从「纯本地操作」变成「要联网」，需单独确认。

---

## 10. 迁移与发版

1. `drizzle/0005_*.sql`（编号按实际目录递增）手写 `CREATE TABLE attachments` + 索引 + 两个 CHECK。
2. 先 `pg_dump` 备份，再查 `information_schema.tables` 确认 `attachments` 不存在（多数迁移无 `IF NOT EXISTS`，**只能跑一次**）。
3. `psql -f` 执行，核对 `information_schema.columns`。
4. 本功能是**加表 + 加列？不加列**：`diary_entries` 一列不动（正文引用在密文里）⇒ 兼容性最好，老客户端不受影响。
5. 环境变量先上服务器 `.env`（改 `.env` 不需要重新部署，但要 `pm2 restart` 才生效——`start.sh` 每次启动重新 source）。
6. 发版顺序照旧：`npm run verify` → commit → tag → 双远程推 → 迁移 → `deploy.sh` → 独立核验。
7. **上线前手动核验**（比 curl 更重要，因为这是第一次引入外部存储）：
   - 传一张图 → 抓包确认请求体**不是**可识别的图片字节（应是随机密文）；
   - OSS 控制台里对象大小与本地原图大小对不上（说明确实加密了）；
   - 数据库 `attachments` 表里**没有任何图片内容列**；
   - 断网后重开 App，已缓存的图仍能显示。

---

## 11. 守卫测试清单（沿用本项目方法学）

新增 `tests/attachments.test.ts`（或按主题拆两个）：

| 编号 | 断言 |
|---|---|
| A1 | schema 存在 `attachments` 表且**不含任何图片内容列**（台账对账，防「顺手把密文存进库」） |
| A2 | `Markdown.tsx` 的 `img` 组件：只对 `qo-attachment://` 渲染真实图片，其余维持占位（反向断言：外链不得渲染成 `<img>`） |
| A3 | `urlTransform` 放行 `qo-attachment://`（不做 ⇒ 引用被静默清空） |
| A4 | 排版规则只有一套：单图 / 二图 / 三列宫格三档，且**不得出现 `object-fit: cover` 用于单图** |
| A5 | `img-src` 含 `blob:`（dev 与 prod 两处 CSP 都断言） |
| A6 | 三条新路由**同时**在 `proxy.ts` matcher 与 `protectedPaths` 中登记（可由既有覆盖测试扩展） |
| A7 | 上传体积上限存在且服务端、Zod 两处都有 |
| A8 | RAM 策略不含 `oss:ListBucket`（读策略文件做 token 级断言） |
| A9 | 缓存里**只有密文**（对写入值做断言，不含明文字节） |
| A10 | `qo-offline-cache` 关闭时附件不落本地（读源码分支断言） |
| B1 | blob 端点**流式**转发（断言源码里用 `createReadStream`/pipeline，不是 `readFile` 全文进内存） |
| B2 | Lightbox 关闭时 `revokeObjectURL` + `aliveRef` 取消语义 |
| B3 | 导出超阈值有明确提示，不静默截断 |

**非空转验证**（铁律）：`Temp/nonvacuous_attachments.py`，逐条临时破坏 → 确认变红 → **按原始字节还原**（不要用反向 replace；注意 CRLF/LF）。

---

## 12. 风险与开放问题

| 风险 | 影响 | 处置 |
|---|---|---|
| **iOS Safari 内存**（解码大图 + blob 生命周期） | 崩溃 / 被杀 | 尺寸上限、串行解码、复用 blob、Lightbox 复用缓存 |
| **blob URL 泄漏**（忘记 revoke） | 内存持续上涨 | 守卫 B2；`useEffect` cleanup 必查 |
| **`zip.ts` 内存拼接** | 大导出 OOM | §9 两条；必要时改分片写入 |
| **OSS 依赖把产物撑大**（`ali-oss`） | 部署变慢 / 体积涨 | 部署后核对体积；必要时换轻量 S3 签名实现 |
| 1.8G 服务器当流量转发器 | 内存/带宽压力 | 流式 + immutable 缓存；必要时切方案 B |
| 附件与正文两条链路的状态组合爆炸 | 用户困惑 | 编辑器只显示一个「上传中/待重试」小状态点，不做复杂状态机 UI |
| 旧客户端读到新正文 | 引用无法解析 | 占位文案兜底（旧客户端 `img` 组件本就只出占位） |
| **开放问题**：是否需要「原画质」偏好（1600px vs 2560px + 不压缩） | 存储/体验权衡 | 建议二期加一个布尔偏好，走既有偏好三处同步 |
| **开放问题**：Lightbox 是否允许长按保存原图 | 会绕过 E2EE 语义（但用户自己的图） | 建议不做，保持「看过即逝」 |

---

## 13. 里程碑（每个都要有守卫 + 非空转验证）

| 里程碑 | 内容 | 完成判据 |
|---|---|---|
| M1 后端地基 | migration + 3 路由 + OSS 接入 + CSP 放行 `blob:` | curl 上传/下载**密文**成功；OSS 控制台可见随机 key 对象；A1/A5/A6/A7/A8 绿 |
| M2 客户端管线 | 重编码 + `encryptBytes` + 缓存 + 上传队列 + 编辑器插入 | 选图后本机立即可见；刷新后仍在；断网重试可用；A9/B1 绿 |
| M3 渲染与交互 | Markdown 渲染分支 + 排版三档 + Lightbox + 列表缩略图 + 三态 | 真机 iOS 无跳版无裁切；A2/A3/A4/B2 绿 |
| M4 离线与导出 | 离线缓存不变量、孤儿 GC、导出 zip 带图、偏好联动 | 断网可看已缓存图；导出能被 Day One 打开；A10/B3 绿 |

依赖：M1 必须先落 CSP 与路由登记；M2 依赖 M1；M3 可与 M2 并行；M4 最后（它依赖前三者的稳定形态）。

---

## 14. 费用复核（2026-10 官方价，中国内地标准型本地冗余）

- 存储 **¥0.12/GB/月**；外网流出 忙时 ¥0.50/GB、闲时 ¥0.25/GB；CDN 回源 ¥0.15/GB；**上传与同地域内网流量免费**。
- 请求：PUT 每月 500 万次、GET 每月 2000 万次**免费** ⇒ 个人用量恒 ¥0。
- 估算（主图 350KB + 缩略 20KB）：20 张/月 ≈ **¥0.02**；60 张/月 ≈ **¥0.07**；100 张原图/月 ≈ **¥0.65**；每天 10 张原图 ≈ **¥2.9**。
- 方案 A（中转）下图片流量走 ECS 已付带宽 ⇒ OSS 侧只有存储费，**比上表更低**。
- 存储包 40GB/年 ¥9（够用十年）；七牛云每月 10GB 免费额度可作为将来降本选项，但**换云要重做 RAM/域名/CSP**，本项目不建议为省几毛钱迁移。
- 结论：**成本不构成选型理由，工程量才是。**
