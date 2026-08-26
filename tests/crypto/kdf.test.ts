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
    // KEK 不可导出（安全设计，extractable=false），以行为验证：k1 加密的密文 k2 必须解不开
    const iv = new Uint8Array(12)
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k1, new TextEncoder().encode('probe'))
    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k2, ct)).rejects.toThrow()
  })
  it('same inputs -> same key', async () => {
    const ikm = new Uint8Array(32).fill(7)
    const salt = new Uint8Array(16).fill(3)
    const k1 = await deriveKek(ikm, salt, 'passkey-kek')
    const k2 = await deriveKek(ikm, salt, 'passkey-kek')
    // HKDF 确定性：k1 加密的密文 k2 能解开 → 两把密钥相同
    const iv = new Uint8Array(12)
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k1, new TextEncoder().encode('probe'))
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k2, ct)
    expect(new TextDecoder().decode(pt)).toBe('probe')
  })
})
