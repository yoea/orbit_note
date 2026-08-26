import { describe, expect, it } from 'vitest'
import { toBase64, fromBase64 } from '../../lib/client/crypto/base64'

describe('base64', () => {
  it('roundtrip', () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255])
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
  })
  it('handles empty', () => {
    expect(toBase64(new Uint8Array(0))).toBe('')
    expect(fromBase64('')).toEqual(new Uint8Array(0))
  })
})
