// UUIDv5 的守卫测试。幂等性全靠它——写错了表现是"重复导入产生重复日记"，很难当场发现。
import { describe, expect, it } from 'vitest'
import { ORBIT_IMPORT_NAMESPACE, hex32ToUuid, isUuid, uuidToHex32, uuidV5 } from '@/lib/client/uuid-v5'

describe('UUIDv5', () => {
  it('符合 RFC 4122 附录 B 的示例（DNS 命名空间 + www.example.com）', async () => {
    // RFC 给的期望值：2ed6657d-e927-568b-95e1-2665a8aea6a2
    const got = await uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')
    expect(got).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2')
  })

  it('同输入同输出、不同输入不同输出（幂等的基础）', async () => {
    const a = await uuidV5('entry-1')
    expect(await uuidV5('entry-1')).toBe(a)
    expect(await uuidV5('entry-2')).not.toBe(a)
    expect(isUuid(a)).toBe(true)
  })

  it('版本位与变体位正确（否则某些库会拒绝解析）', async () => {
    const u = await uuidV5('whatever')
    expect(u[14]).toBe('5')
    expect(['8', '9', 'a', 'b']).toContain(u[19])
  })

  it('默认命名空间固定（改了会让历史导入失去幂等，所以钉住）', async () => {
    expect(ORBIT_IMPORT_NAMESPACE).toBe('1f0a3b7c-5d2e-4a91-9c63-7b8e4f2a6d10')
    expect(await uuidV5('x')).toBe(await uuidV5('x', ORBIT_IMPORT_NAMESPACE))
  })
})

describe('id 形态互转', () => {
  it('uuid ↔ 32 位 hex 可往返', () => {
    const u = '0b6f1a2c-3d4e-4f50-8a9b-1c2d3e4f5a6b'
    expect(hex32ToUuid(uuidToHex32(u))).toBe(u)
    expect(uuidToHex32(u)).toHaveLength(32)
    expect(uuidToHex32(u)).toBe(uuidToHex32(u).toUpperCase())
  })

  it('长度/字符不对时返回 null（让调用方回落到"按内容派生"）', () => {
    expect(hex32ToUuid('abc')).toBeNull()
    expect(hex32ToUuid('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toBeNull()
  })

  it('isUuid 只认标准形态', () => {
    expect(isUuid('0b6f1a2c-3d4e-4f50-8a9b-1c2d3e4f5a6b')).toBe(true)
    expect(isUuid('0B6F1A2C-3D4E-4F50-8A9B-1C2D3E4F5A6B')).toBe(true)
    expect(isUuid(uuidToHex32('0b6f1a2c-3d4e-4f50-8a9b-1c2d3e4f5a6b'))).toBe(false)
    expect(isUuid(undefined)).toBe(false)
  })
})
