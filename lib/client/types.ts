// 客户端与服务端共享的行类型（GET /api/keys/wrappers 响应结构）
// recoveryKeyFingerprint / createdAt 为 GET v2.5 起新增：完整 recoveryKeyHash 已停止下发，
// 前端只拿 8 位指纹辨认密钥；离线缓存 offline:wrappers 里的旧数据没有这两个字段（可选）。
export interface WrappedKeyRow {
  id: string
  wrapperType: 'passkey_prf' | 'recovery'
  credentialId: string | null
  encryptedDek: string
  salt: string
  encryptionVersion: number
  /** 仅 recovery 行：SHA-256 哈希前 8 位（小写 hex），不可逆、不能还原明文 */
  recoveryKeyFingerprint?: string | null
  /** ISO 字符串；recovery 行 = 当前这把密钥的创建时刻（换新即刷新） */
  createdAt?: string
}
