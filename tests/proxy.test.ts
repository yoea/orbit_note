import { describe, expect, it } from 'vitest'
import { decideLoginRedirect } from '../lib/server/proxy-guard'

describe('proxy 路由保护判定（decideLoginRedirect）', () => {
  it('受保护路径无 cookie → 重定向 /login', () => {
    expect(decideLoginRedirect('/', false)).toBe(true)
    expect(decideLoginRedirect('/diary', false)).toBe(true)
    expect(decideLoginRedirect('/history', false)).toBe(true)
    expect(decideLoginRedirect('/entry/abc-123', false)).toBe(true)
    expect(decideLoginRedirect('/settings', false)).toBe(true)
    expect(decideLoginRedirect('/settings/passkey', false)).toBe(true)
  })
  it('受保护路径有 cookie → 不重定向', () => {
    expect(decideLoginRedirect('/', true)).toBe(false)
    expect(decideLoginRedirect('/diary', true)).toBe(false)
    expect(decideLoginRedirect('/history', true)).toBe(false)
    expect(decideLoginRedirect('/entry/abc-123', true)).toBe(false)
    expect(decideLoginRedirect('/settings/recovery', true)).toBe(false)
  })
  it('/login /setup 恒不重定向（DEK 仅内存 ⇒ /login 必须恒可达）', () => {
    expect(decideLoginRedirect('/login', false)).toBe(false)
    expect(decideLoginRedirect('/login', true)).toBe(false)
    expect(decideLoginRedirect('/setup', false)).toBe(false)
    expect(decideLoginRedirect('/setup', true)).toBe(false)
  })
})
