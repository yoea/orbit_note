import { describe, expect, it } from 'vitest'
import { buildPrfExtensions, normalizePrfResult } from '../lib/client/webauthn'
import { toBase64Url } from '../lib/client/crypto/base64'

describe('buildPrfExtensions（WebAuthn L3 PRF 扩展）', () => {
  it('eval.first 必须是 Uint8Array（BufferSource）而非字符串', () => {
    const first = new Uint8Array(32).fill(7)
    const ext = buildPrfExtensions(first)
    expect(ext.prf.eval.first).toBeInstanceOf(Uint8Array)
    expect(ext.prf.eval.first).toBe(first)
    expect(typeof ext.prf.eval.first).toBe('object') // 不是 string
  })

  it('32 字节输入保持不变', () => {
    const first = crypto.getRandomValues(new Uint8Array(32))
    const ext = buildPrfExtensions(first)
    expect(ext.prf.eval.first.length).toBe(32)
    expect(ext.prf.eval.first).toEqual(first)
  })
})

describe('normalizePrfResult（iOS 二进制兼容）', () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const b64url = toBase64Url(bytes)

  it('字符串原样返回', () => {
    expect(normalizePrfResult(b64url)).toBe(b64url)
  })
  it('Uint8Array 转 base64url 字符串', () => {
    expect(normalizePrfResult(bytes)).toBe(b64url)
  })
  it('ArrayBuffer 转 base64url 字符串', () => {
    expect(normalizePrfResult(bytes.buffer as ArrayBuffer)).toBe(b64url)
  })
  it('null/undefined 返回 null', () => {
    expect(normalizePrfResult(null)).toBeNull()
    expect(normalizePrfResult(undefined)).toBeNull()
  })
  it('数字数组转 base64url 字符串', () => {
    expect(normalizePrfResult([...bytes])).toBe(b64url)
  })
})
