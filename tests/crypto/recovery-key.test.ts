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
