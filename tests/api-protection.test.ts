import { describe, expect, it, vi } from 'vitest'

// route import 链含 'server-only'（vitest node 环境解析到会 throw 的 index.js 入口，必须 mock 为空）
vi.mock('server-only', () => ({}))

// mock db：credentials 表已初始化（1 行）——403 分支在 db 查询后、认证检查处返回，无需真实数据库
vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        limit: async () => [{}],
      }),
    }),
  },
}))

// 直调 route handler：无 cookie → 401（requireAuth 在 db 访问之前返回）——Task 14 用例保留
describe('diary API 认证保护', () => {
  it('无 cookie POST diary → 401', async () => {
    const { POST: diaryPost } = await import('../app/api/diary/route')
    const res = await diaryPost(new Request('http://localhost:3000/api/diary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ciphertext: 'x', iv: 'y' }),
    }))
    expect(res.status).toBe(401)
  })
})

describe('注册保护（C1 回归：必须完整验证 JWT，伪造 cookie 不得绕过）', () => {
  it('已初始化 + 伪造 cookie GET register/options → 403', async () => {
    const { GET } = await import('../app/api/auth/register/options/route')
    const res = await GET(new Request('http://localhost:3000/api/auth/register/options', {
      headers: { cookie: 'qo_session=forged-token' },
    }))
    expect(res.status).toBe(403)
  })

  it('已初始化 + 伪造 cookie POST register → 403', async () => {
    const { POST } = await import('../app/api/auth/register/route')
    const res = await POST(new Request('http://localhost:3000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: 'qo_session=forged-token' },
      body: JSON.stringify({ token: 'x', registration: { id: 'abc', response: {} } }),
    }))
    expect(res.status).toBe(403)
  })

  it('已初始化 + 无 cookie POST register → 403（原有行为保持）', async () => {
    const { POST } = await import('../app/api/auth/register/route')
    const res = await POST(new Request('http://localhost:3000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'x', registration: { id: 'abc', response: {} } }),
    }))
    expect(res.status).toBe(403)
  })
})

describe('profile API 认证保护（用户名端点，Task 回归）', () => {
  it('无 cookie GET profile → 401', async () => {
    const { GET } = await import('../app/api/profile/route')
    const res = await GET(new Request('http://localhost:3000/api/profile'))
    expect(res.status).toBe(401)
  })

  it('无 cookie PUT profile → 401', async () => {
    const { PUT } = await import('../app/api/profile/route')
    const res = await PUT(new Request('http://localhost:3000/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nameCiphertext: 'x', nameIv: 'y' }),
    }))
    expect(res.status).toBe(401)
  })
})

describe('assertSameOrigin（I2 CSRF 纵深校验）', () => {
  it('sec-fetch-site: same-origin → 通过', async () => {
    const { assertSameOrigin } = await import('../lib/server/auth')
    const req = new Request('http://localhost:3000/api/x', { headers: { 'sec-fetch-site': 'same-origin' } })
    expect(assertSameOrigin(req)).toBe(true)
  })
  it('sec-fetch-site: none → 通过', async () => {
    const { assertSameOrigin } = await import('../lib/server/auth')
    const req = new Request('http://localhost:3000/api/x', { headers: { 'sec-fetch-site': 'none' } })
    expect(assertSameOrigin(req)).toBe(true)
  })
  it('sec-fetch-site: cross-site → 拒绝', async () => {
    const { assertSameOrigin } = await import('../lib/server/auth')
    const req = new Request('http://localhost:3000/api/x', { headers: { 'sec-fetch-site': 'cross-site' } })
    expect(assertSameOrigin(req)).toBe(false)
  })
  it('无 sec-fetch-site + 同源 Origin → 通过', async () => {
    const { assertSameOrigin } = await import('../lib/server/auth')
    const req = new Request('http://localhost:3000/api/x', { headers: { origin: 'http://localhost:3000' } })
    expect(assertSameOrigin(req)).toBe(true)
  })
  it('无 sec-fetch-site + 异源 Origin → 拒绝', async () => {
    const { assertSameOrigin } = await import('../lib/server/auth')
    const req = new Request('http://localhost:3000/api/x', { headers: { origin: 'http://evil.example.com' } })
    expect(assertSameOrigin(req)).toBe(false)
  })
  it('无 sec-fetch-site + 无 Origin → 通过（同源简单请求由 SameSite=Lax 保护）', async () => {
    const { assertSameOrigin } = await import('../lib/server/auth')
    const req = new Request('http://localhost:3000/api/x')
    expect(assertSameOrigin(req)).toBe(true)
  })
  it('无 sec-fetch-site + 畸形 Origin → 拒绝', async () => {
    const { assertSameOrigin } = await import('../lib/server/auth')
    const req = new Request('http://localhost:3000/api/x', { headers: { origin: 'not-a-url' } })
    expect(assertSameOrigin(req)).toBe(false)
  })
})
