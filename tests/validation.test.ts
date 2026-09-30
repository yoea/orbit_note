import { describe, expect, it } from 'vitest'
import { diaryCreateSchema, diaryImportEntrySchema, diaryUpdateSchema, draftPutSchema, wrapperSchema } from '../lib/server/validation'

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

  // ── 收藏（星标）与结构化地名 ──────────────────────────────────────────────
  it('创建：不带 starred 走服务端默认 false；带 false 也接受（离线队列补传）', () => {
    expect(diaryCreateSchema.safeParse({ ciphertext: 'x', iv: 'y' }).success).toBe(true)
    expect(diaryCreateSchema.safeParse({ ciphertext: 'x', iv: 'y', starred: false }).success).toBe(true)
    expect(diaryCreateSchema.safeParse({ ciphertext: 'x', iv: 'y', starred: true }).success).toBe(true)
  })
  it('starred 必须是布尔（拒绝 0 / "true" 这类会被当真值的东西）', () => {
    expect(diaryCreateSchema.safeParse({ ciphertext: 'x', iv: 'y', starred: 1 }).success).toBe(false)
    expect(diaryUpdateSchema.safeParse({ starred: 'true' }).success).toBe(false)
  })
  it('更新：只有 starred 也算有效更新（收藏是纯元数据，不带 ciphertext）', () => {
    expect(diaryUpdateSchema.safeParse({ starred: true }).success).toBe(true)
    // 收藏**不更新** updatedAt —— 前提就是这条路径不带 ciphertext/iv
    const parsed = diaryUpdateSchema.parse({ starred: true })
    expect(parsed.ciphertext).toBeUndefined()
    expect(parsed.iv).toBeUndefined()
  })
  it('更新：接受结构化三级地名（省/市/区），允许显式 null 清空某一级', () => {
    expect(diaryUpdateSchema.safeParse({
      locationProvince: '云南省', locationCity: '昆明市', locationDistrict: '五华区',
    }).success).toBe(true)
    expect(diaryUpdateSchema.safeParse({ locationDistrict: null }).success).toBe(true)
  })
  it('地名长度上限 64：超长拒绝（避免整串塞进这一列）', () => {
    expect(diaryUpdateSchema.safeParse({ locationProvince: 'x'.repeat(65) }).success).toBe(false)
    expect(diaryUpdateSchema.safeParse({ locationProvince: 'x'.repeat(64) }).success).toBe(true)
  })
  it('创建路径**不接受**结构化地名：地点只在 PATCH 补写（POST 时坐标还是 null）', () => {
    expect(diaryCreateSchema.safeParse({ ciphertext: 'x', iv: 'y', locationProvince: '云南省' }).success).toBe(false)
  })
  it('导入路径接受结构化地名与 starred（备份恢复要能原样写回）', () => {
    expect(diaryImportEntrySchema.safeParse({
      id: '00000000-0000-4000-8000-000000000000',
      ciphertext: 'x', iv: 'y',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      starred: true,
      locationProvince: '云南省', locationCity: '昆明市', locationDistrict: '五华区',
    }).success).toBe(true)
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
