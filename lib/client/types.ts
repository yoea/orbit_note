// 客户端与服务端共享的行类型（GET /api/keys/wrappers 响应结构）
export interface WrappedKeyRow {
  id: string
  wrapperType: 'passkey_prf' | 'recovery'
  credentialId: string | null
  encryptedDek: string
  salt: string
  encryptionVersion: number
}
