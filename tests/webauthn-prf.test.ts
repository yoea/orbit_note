import { describe, expect, it } from 'vitest'
import { buildPrfExtensions } from '../lib/client/webauthn'

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
