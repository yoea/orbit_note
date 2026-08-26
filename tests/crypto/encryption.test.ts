import { describe, expect, it } from 'vitest'
import { decryptText, encryptText, generateDek, randomBytes } from '../../lib/client/crypto/encryption'
import { decodeWrapped, encodeWrapped } from '../../lib/client/crypto/wrapper'

describe('AES-256-GCM 日记加密', () => {
  it('encrypt/decrypt roundtrip 中文+emoji+换行', async () => {
    const dek = await generateDek()
    const text = '今天晚上突然想写点东西……\n😀 ❤️ 🥹\n第二行'
    const { ciphertext, iv } = await encryptText(dek, text)
    expect(ciphertext).not.toContain('东西')
    expect(await decryptText(dek, ciphertext, iv)).toBe(text)
  })
  it('每篇日记 IV 唯一', async () => {
    const dek = await generateDek()
    const a = await encryptText(dek, 'hello')
    const b = await encryptText(dek, 'hello')
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })
  it('篡改 ciphertext 必须解密失败', async () => {
    const dek = await generateDek()
    const { ciphertext, iv } = await encryptText(dek, 'secret text')
    const bytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0))
    bytes[0] ^= 0xff
    const tampered = btoa(String.fromCharCode(...bytes))
    await expect(decryptText(dek, tampered, iv)).rejects.toThrow()
  })
  it('篡改 IV 必须解密失败', async () => {
    const dek = await generateDek()
    const { ciphertext, iv } = await encryptText(dek, 'secret text')
    const bytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0))
    bytes[0] ^= 0x01
    const tamperedIv = btoa(String.fromCharCode(...bytes))
    await expect(decryptText(dek, ciphertext, tamperedIv)).rejects.toThrow()
  })
  it('错误 key 必须解密失败', async () => {
    const dek = await generateDek()
    const other = await generateDek()
    const { ciphertext, iv } = await encryptText(dek, 'secret')
    await expect(decryptText(other, ciphertext, iv)).rejects.toThrow()
  })
  it('randomBytes 生成 96-bit IV 长度', () => {
    expect(randomBytes(12).length).toBe(12)
  })
  it('wrapper iv 内嵌往返', async () => {
    // generateDek() 的 DEK 可导出（extractable=true，决策 A），raw 字节即包裹载荷
    const dek = await generateDek()
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dek))
    // 决策 B：IV 由调用方传入（与 AES-GCM 加密所用 IV 一致），encodeWrapped 只做拼接编码
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const wrapped = encodeWrapped(iv, raw.buffer as ArrayBuffer)
    const decoded = decodeWrapped(wrapped)
    expect(decoded.iv).toEqual(iv)
    expect(decoded.data).toEqual(raw)
  })
})
