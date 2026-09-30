// UUIDv5（RFC 4122 §4.3）：SHA-1(namespace ‖ name) 取前 16 字节，再写入 version=5、variant=10xx。
//
// 用途：把外部日记文件里的条目标识（Day One 的 32 位 hex、或任意字符串）**确定性地**映射成
// 本地条目 id。确定性 = 幂等：同一份文件导入两次，第二次算出的 id 与第一次完全相同，
// 服务端按 id 命中已有条目直接跳过，不会翻倍——这正是"重复导入同一备份不会产生重复日记"的实现基础。
//
// 关于 SHA-1：这是 RFC 明确规定的算法，用途是**稳定派生标识符**，不是安全原语——
// 没有密钥、不用于完整性校验；攻击者构造碰撞的唯一后果是两条不同日记被判为同一条，
// 在单用户本地应用里不构成威胁。**别改成 sha256**：那会让所有历史导入失去幂等（id 全变）。
//
// 命名空间固定不可改：改了等于换一套 id 算法，旧备份再导入会全部变成新条目。
export const ORBIT_IMPORT_NAMESPACE = '1f0a3b7c-5d2e-4a91-9c63-7b8e4f2a6d10'

const TE = new TextEncoder()

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

/** 去掉连字符并大写（Day One 的 uuid 字段就是这种 32 位大写 hex） */
export function uuidToHex32(uuid: string): string {
  return uuid.replace(/-/g, '').toUpperCase()
}

/** 32 位 hex → 标准带连字符的小写 UUID；长度不对返回 null（调用方据此回落其它策略） */
export function hex32ToUuid(hex: string): string | null {
  const h = hex.replace(/[^0-9a-fA-F]/g, '').toLowerCase()
  if (h.length !== 32) return null
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '')
  const out = new Uint8Array(16)
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function bytesToUuid(b: Uint8Array): string {
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function uuidV5(name: string, namespace = ORBIT_IMPORT_NAMESPACE): Promise<string> {
  const ns = uuidToBytes(namespace)
  const nameBytes = TE.encode(name)
  const buf = new Uint8Array(16 + nameBytes.length)
  buf.set(ns, 0)
  buf.set(nameBytes, 16)
  // WebCrypto 允许 SHA-1 用于 digest（禁止的是签名/密钥派生场景）
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', buf)).slice(0, 16)
  digest[6] = (digest[6] & 0x0f) | 0x50 // version 5
  digest[8] = (digest[8] & 0x3f) | 0x80 // variant RFC 4122
  return bytesToUuid(digest)
}
