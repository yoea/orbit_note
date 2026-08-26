import { describe, expect, it } from 'vitest'
import { pickNewer } from '../lib/client/draft-sync'

describe('pickNewer 冲突决策', () => {
  it('服务器更新 → 选服务器', () => {
    const local = { updatedAt: 1000, text: 'local' }
    const server = { updatedAt: 2000, text: 'server' }
    // 服务器参数无 text 字段，pickNewer 返回新标记对象 { updatedAt, text: '' }（空 text = 别用本地）
    expect(pickNewer(local, server)).toEqual({ updatedAt: server.updatedAt, text: '' })
  })
  it('本地更新 → 选本地', () => {
    const local = { updatedAt: 2000, text: 'local' }
    const server = { updatedAt: 1000, text: 'server' }
    expect(pickNewer(local, server)).toBe(local)
  })
  it('相同时间 → 选服务器（稳定）', () => {
    const local = { updatedAt: 1000, text: 'local' }
    const server = { updatedAt: 1000, text: 'server' }
    expect(pickNewer(local, server)).toEqual({ updatedAt: server.updatedAt, text: '' })
  })
  it('本地空草稿不覆盖服务器', () => {
    const local = { updatedAt: 0, text: '' }
    const server = { updatedAt: 1000, text: 'server' }
    expect(pickNewer(local, server)).toEqual({ updatedAt: server.updatedAt, text: '' })
  })
})
