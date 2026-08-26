import { describe, expect, it, vi } from 'vitest'
// server-only 在非 Next（vitest node）环境 import 即报错（route 导入链：auth → session），mock 为空对象
vi.mock('server-only', () => ({}))
import { POST as diaryPost } from '../app/api/diary/route'

// 直调 route handler：无 cookie → 401（requireAuth 在 db 访问之前返回）
describe('diary API 认证保护', () => {
  it('无 cookie → 401', async () => {
    const res = await diaryPost(new Request('http://localhost/api/diary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ciphertext: 'x', iv: 'y' }),
    }))
    expect(res.status).toBe(401)
  })
})
