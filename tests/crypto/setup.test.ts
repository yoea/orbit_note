import { describe, expect, it } from 'vitest'
import { createWrappedDek, unwrapWithRecoveryKey, wrapWithKek, derivePrfKek } from '../../lib/client/crypto/setup'
import { decryptText, encryptText } from '../../lib/client/crypto/encryption'
import { prfEvalB64 } from '../../lib/client/crypto/prf'
import { decodeRecoveryKey } from '../../lib/client/crypto/recovery-key'

// derivePrfKek 强制校验 PRF 输出为 32 字节，测试用固定 32 字节 IKM
const prfIkm32 = new TextEncoder().encode('quiet-orbit-prf-output-32-bytes!')

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
  it('recovery 重新生成往返（新密钥解包新 wrapper）', async () => {
    // 回归（质量审查 C3）：IKM 必须用 decodeRecoveryKey 解码后的 32 字节，
    // 用 43 字符 ASCII 文本作 IKM 会导致新 wrapper 永远解不开
    const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    const next = 'x'.repeat(43) // 占位（生产由 generateRecoveryKey 生成；'x' 是合法 base64url 字符）
    const wrapped = await createWrappedDek(dek, decodeRecoveryKey(next), 'recovery-kek')
    const restored = await unwrapWithRecoveryKey(wrapped.encryptedDek, wrapped.salt, next)
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
    // wrapWithKek 不返回 salt（HKDF salt 由调用方管理），只产出 encryptedDek
    const { encryptedDek } = await wrapWithKek(dek, kek)
    // encryptedDek 应为 base64(iv+cipher)，长度 > 0
    expect(encryptedDek.length).toBeGreaterThan(0)
  })
  it('derivePrfKek 派生确定性 KEK', async () => {
    const salt = 'c2FsdA==' // "salt" base64
    const kek1 = await derivePrfKek(prfEvalB64(new Uint8Array(prfIkm32.buffer)), salt)
    const kek2 = await derivePrfKek(prfEvalB64(new Uint8Array(prfIkm32.buffer)), salt)
    // 相同输入 → 相同 KEK：用同一密文验证
    const raw = new Uint8Array(32).fill(9)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct1 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek1, raw)
    const pt2 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek2, ct1)
    expect(new Uint8Array(pt2)).toEqual(raw)
  })
  it('derivePrfKek 接受 base64url 无 padding 的 salt', async () => {
    // Task 8 前端可能把 prfEvalB64(S)（base64url 无 padding）直接存入 wrapper salt：必须能规范化解析
    const saltBytes = crypto.getRandomValues(new Uint8Array(16))
    const saltB64url = prfEvalB64(saltBytes)
    const kek1 = await derivePrfKek(prfEvalB64(new Uint8Array(prfIkm32.buffer)), saltB64url)
    const raw = new Uint8Array(32).fill(5)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek1, raw)
    const kek2 = await derivePrfKek(prfEvalB64(new Uint8Array(prfIkm32.buffer)), saltB64url)
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek2, ct)
    expect(new Uint8Array(pt)).toEqual(raw)
  })
  it('derivePrfKek 拒绝非 32 字节 PRF 输出', async () => {
    const short = prfEvalB64(new Uint8Array(16).fill(1))
    await expect(derivePrfKek(short, 'c2FsdA==')).rejects.toThrow('PRF 输出长度无效')
  })
})
