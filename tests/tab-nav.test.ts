import { describe, expect, it } from 'vitest'
import { TAB_HREFS, activeTab } from '@/lib/client/nav'

// 底部 TabBar 的高亮归属逻辑（纯函数）。
// 这里守住的关键不变量：`/` 必须精确匹配——若按前缀匹配，空 base 会吞掉所有路径，
// 导致任何页面都点亮「写」。

describe('activeTab', () => {
  it('三个 tab 目的地各自高亮', () => {
    expect(activeTab('/')).toBe('/')
    expect(activeTab('/diary')).toBe('/diary')
    expect(activeTab('/settings')).toBe('/settings')
  })

  it('根路径精确匹配，不吞掉其他路径', () => {
    for (const p of ['/diary', '/settings', '/settings/export', '/entry/abc']) {
      expect(activeTab(p)).not.toBe('/')
    }
  })

  it('子路径归各自父 tab', () => {
    // 注意：偏好设置已改为弹窗（无 /settings/prefs 路由），子页只剩 export / passkey
    expect(activeTab('/settings/export')).toBe('/settings')
    expect(activeTab('/settings/passkey')).toBe('/settings')
    expect(activeTab('/diary/anything')).toBe('/diary')
  })

  it('/entry/* 归「日记」（详情是列表的下级）', () => {
    expect(activeTab('/entry')).toBe('/diary')
    expect(activeTab('/entry/1f2e3d')).toBe('/diary')
  })

  it('组外页面不属于任何 tab（那里也不渲染 TabBar）', () => {
    for (const p of ['/login', '/setup', '/history', '/unknown']) {
      expect(activeTab(p)).toBeNull()
    }
  })

  it('返回值必然是 TAB_HREFS 之一或 null', () => {
    const all = ['/', '/diary', '/settings', '/settings/export', '/entry/x', '/login', '/setup']
    for (const p of all) {
      const t = activeTab(p)
      if (t !== null) expect(TAB_HREFS).toContain(t)
    }
  })
})
