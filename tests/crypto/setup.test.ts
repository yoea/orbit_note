import { describe, expect, it } from 'vitest'
import { createWrappedDek, unwrapWithRecoveryKey, wrapWithKek, derivePrfKek } from '../../lib/client/crypto/setup'
import { decryptText, encryptText } from '../../lib/client/crypto/encryption'
import { prfEvalB64 } from '../../lib/client/crypto/prf'
import { decodeRecoveryKey } from '../../lib/client/crypto/recovery-key'

describe('setup 密钥流程', () => {
  it('recovery wrapper 往返', async () => {
    const recoveryKey = 'a'.repeat(43) // 占位格式（测试用固定值；生产由 generateRecoveryKey 生成）
    const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    // IKM 必须是解码后的 32 字节（与 unwrapWithRecoveryKey 内部 decodeRecoveryKey 一致）
    const wrapped = await createWrappedDek(dek, decodeRecoveryKey(recoveryKey), 'recovery-kek')
    expect(wrapped.salt).toBeTruthy()
    const restored = await unwrapWithRecoveryKey(wrapped.encryptedDek, wrapped.salt, recoveryKey)
    // 用恢复出的 DEK 加密，原 DEK 解密
    const { ciphertext, iv } = await encryptText(restored, 'ok')
    expect(await decryptText(dek, ciphertext, iv)).toBe('ok')
  })
  it('错误 recovery key 必须失败', async () => {
    const recoveryKey = 'b'.repeat(43)
    const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    const wrapped = await createWrappedDek(dek, decodeRecoveryKey(recoveryKey), 'recovery-kek')
    await expect(unwrapWithRecoveryKey(wrapped.encryptedDek, wrapped.salt, 'c'.repeat(43))).rejects.toThrow()
  })
  it('wrapWithKek 生成可解包格式', async () => {
    const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    const kek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    const { encryptedDek } = await wrapWithKek(dek, kek)
    // encryptedDek 应为 base64(iv+cipher)，长度 > 0
    expect(encryptedDek.length).toBeGreaterThan(0)
  })
  it('derivePrfKek 派生确定性 KEK', async () => {
    const ikm = new TextEncoder().encode('prf-output-32-bytes-x')
    const salt = 'c2FsdA==' // "salt" base64
    const kek1 = await derivePrfKek(prfEvalB64(new Uint8Array(ikm.buffer)), salt)
    const kek2 = await derivePrfKek(prfEvalB64(new Uint8Array(ikm.buffer)), salt)
    // 相同输入 → 相同 KEK：用同一密文验证
    const raw = new Uint8Array(32).fill(9)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct1 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek1, raw)
    const pt2 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek2, ct1)
    expect(new Uint8Array(pt2)).toEqual(raw)
  })
})
