import { describe, expect, it } from 'vitest'
import { diaryCreateSchema, diaryUpdateSchema, draftPutSchema, wrapperSchema } from '../lib/server/validation'

describe('zod 校验', () => {
  it('接受合法日记创建', () => {
    expect(diaryCreateSchema.safeParse({ ciphertext: 'x', iv: 'y', encryptionVersion: 1, latitude: 31.2 }).success).toBe(true)
  })
  it('拒绝客户端伪造时间/id', () => {
    expect(diaryCreateSchema.safeParse({ ciphertext: 'x', iv: 'y', id: 'abc', createdAt: '2026' }).success).toBe(false)
  })
  it('拒绝超长密文', () => {
    expect(diaryCreateSchema.safeParse({ ciphertext: 'x'.repeat(300_001), iv: 'y' }).success).toBe(false)
  })
  it('拒绝非法经纬度', () => {
    expect(diaryCreateSchema.safeParse({ ciphertext: 'x', iv: 'y', latitude: 100 }).success).toBe(false)
  })
  it('更新必须 ciphertext/iv 成对', () => {
    expect(diaryUpdateSchema.safeParse({ ciphertext: 'x' }).success).toBe(false)
    expect(diaryUpdateSchema.safeParse({ ciphertext: 'x', iv: 'y' }).success).toBe(true)
  })
  it('更新拒绝空对象', () => {
    expect(diaryUpdateSchema.safeParse({}).success).toBe(false)
  })
  it('draft 拒绝 location 字段', () => {
    expect(draftPutSchema.safeParse({ ciphertext: 'x', iv: 'y', latitude: 1 }).success).toBe(false)
  })
  it('wrapper: passkey_prf 必须含 credentialId 且不含 recoveryKeyHash', () => {
    expect(wrapperSchema.safeParse({ wrapperType: 'passkey_prf', encryptedDek: 'e', salt: 's' }).success).toBe(false)
    expect(wrapperSchema.safeParse({ wrapperType: 'passkey_prf', credentialId: 'c', encryptedDek: 'e', salt: 's', recoveryKeyHash: 'a'.repeat(64) }).success).toBe(false)
    expect(wrapperSchema.safeParse({ wrapperType: 'passkey_prf', credentialId: 'c', encryptedDek: 'e', salt: 's' }).success).toBe(true)
  })
  it('wrapper: recovery 必须含 recoveryKeyHash 且不含 credentialId', () => {
    expect(wrapperSchema.safeParse({ wrapperType: 'recovery', encryptedDek: 'e', salt: 's' }).success).toBe(false)
    expect(wrapperSchema.safeParse({ wrapperType: 'recovery', encryptedDek: 'e', salt: 's', recoveryKeyHash: 'a'.repeat(64) }).success).toBe(true)
    expect(wrapperSchema.safeParse({ wrapperType: 'recovery', credentialId: 'c', encryptedDek: 'e', salt: 's', recoveryKeyHash: 'a'.repeat(64) }).success).toBe(false)
  })
  it('wrapper: recoveryKeyHash 必须 64 位 hex', () => {
    expect(wrapperSchema.safeParse({ wrapperType: 'recovery', encryptedDek: 'e', salt: 's', recoveryKeyHash: 'z'.repeat(64) }).success).toBe(false)
  })
  it('wrapper 拒绝未知字段', () => {
    expect(wrapperSchema.safeParse({ wrapperType: 'passkey_prf', credentialId: 'c', encryptedDek: 'e', salt: 's', evil: 1 }).success).toBe(false)
  })
})
