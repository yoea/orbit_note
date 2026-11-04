import 'server-only'
import OSS from 'ali-oss'

// 阿里云 OSS —— 应用的所有二进制资源（本次：头像；以后：笔记内嵌图片）。
//
// ── 两个 client，各干一件事 ──────────────────────────────────────────────
// ECS 与 bucket 同在 cn-shanghai ⇒ 服务端**读写走内网 endpoint**：不计公网流量费、
// 延迟更低（同地域部署最实在的一项省钱）。
// 但浏览器在公网，**签名 URL 必须用公网 endpoint 生成** —— 内网域名
// （*-internal.aliyuncs.com）在公网根本解析不了，签出来的地址打不开。
// 所以：上传用内网 client，签名用公网 client。
//
// ── key 规范（2026-11-04 建立，为以后的笔记图片预留）──────────────────────
//   orbit/avatar/current          头像（固定 key，覆盖写；无扩展名，靠 Content-Type 识别）
//   orbit/entry/<entryId>/<uuid>  预留：笔记内嵌图片（本次不做）
// ★ 全部资源都压在 `orbit/` 前缀下，这样 RAM 子账号的策略可以只授
//   `acs:oss:*:*:ethan-orbit/orbit/*` —— 主账号下其他资源一概碰不到。
//
// ── 为什么头像 key 不带扩展名 ────────────────────────────────────────────
// 客户端统一输出 WebP，但老环境可能退回 JPEG。带扩展名就得为两种格式各留一个 key、
// 并在换格式时删旧文件；不带扩展名 + 上传时指定 Content-Type，一个 key 通吃。
//
// ── 私有 bucket ──────────────────────────────────────────────────────────
// bucket 开了「阻止公共访问」，头像靠**签名 URL** 读（默认 24 小时）。
// 这是刻意的：日记应用不该有匿名可读的资源路径。

const BUCKET = process.env.OSS_BUCKET?.trim() || 'ethan-orbit'
const REGION = process.env.OSS_REGION?.trim() || 'oss-cn-shanghai'
// 服务端读写：内网（同地域 ECS，不计流量费）
const INTERNAL_ENDPOINT = process.env.OSS_INTERNAL_ENDPOINT?.trim() || 'oss-cn-shanghai-internal.aliyuncs.com'
// 签给浏览器的 URL：必须公网
const PUBLIC_ENDPOINT = process.env.OSS_PUBLIC_ENDPOINT?.trim() || 'oss-cn-shanghai.aliyuncs.com'

/** 应用资源根前缀。所有 key 都必须以它开头（RAM 策略按它收口）。 */
export const OSS_PREFIX = 'orbit/'

/** 头像的固定 key（覆盖写，不产生历史垃圾）。 */
export const AVATAR_KEY = `${OSS_PREFIX}avatar/current`

function credentials(): { accessKeyId: string; accessKeySecret: string } {
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID?.trim()
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET?.trim()
  if (!accessKeyId || !accessKeySecret) {
    // 不在模块加载期抛：只在真正用到时抛，避免没配 OSS 的开发环境整站起不来
    throw new Error('OSS 未配置：缺少 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET')
  }
  return { accessKeyId, accessKeySecret }
}

let uploadClient: OSS | null = null
let signClient: OSS | null = null

/** 上传/删除用（内网 endpoint）。 */
function getUploadClient(): OSS {
  if (!uploadClient) {
    uploadClient = new OSS({ region: REGION, endpoint: INTERNAL_ENDPOINT, bucket: BUCKET, ...credentials() })
  }
  return uploadClient
}

/** 只用来签 URL（公网 endpoint，签出来的地址浏览器才打得开）。 */
function getSignClient(): OSS {
  if (!signClient) {
    signClient = new OSS({ region: REGION, endpoint: PUBLIC_ENDPOINT, bucket: BUCKET, ...credentials() })
  }
  return signClient
}

/** OSS 是否已配置（部署脚本/健康检查用；不抛错）。 */
export function ossConfigured(): boolean {
  return Boolean(process.env.OSS_ACCESS_KEY_ID?.trim() && process.env.OSS_ACCESS_KEY_SECRET?.trim())
}

/** 上传一个 Buffer，返回可选公共读 URL（私有 bucket 下不用它，只用 key）。 */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await getUploadClient().put(key, body, {
    mime: contentType,
    // 私有对象：只让浏览器缓存，不让共享代理缓存
    headers: { 'Cache-Control': 'private, max-age=31536000' },
  })
}

export async function deleteObject(key: string): Promise<void> {
  await getUploadClient().delete(key)
}

/**
 * 生成带签名的临时访问 URL（默认 24 小时）。
 * 前端 `<img src>` 直接用它；过期后下一次 GET /api/profile 会重新签。
 */
export function signedUrl(key: string, expiresSeconds = 86_400): string {
  return getSignClient().signatureUrl(key, { expires: expiresSeconds, method: 'GET' })
}

/**
 * 对象 key 工厂。以后加「笔记内嵌图片」只在这里加一个分支，调用方不用改。
 */
export function assetKey(kind: 'avatar' | 'entryImage', opts?: { entryId?: string; id?: string }): string {
  if (kind === 'avatar') return AVATAR_KEY
  const entryId = opts?.entryId
  if (!entryId) throw new Error('entryImage 需要 entryId')
  const id = opts?.id ?? crypto.randomUUID()
  return `${OSS_PREFIX}entry/${entryId}/${id}`
}
