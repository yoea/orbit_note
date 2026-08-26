import { describe, expect, it, vi } from 'vitest'
// server-only 在非 Next（vitest node）环境 import 即报错，mock 为空对象
vi.mock('server-only', () => ({}))
import { challengeMap, storeChallenge, takeChallenge } from '../lib/server/webauthn'

describe('challenge one-shot 语义', () => {
  it('正确类型可取一次', () => {
    const { token, challenge } = storeChallenge('login')
    expect(takeChallenge(token, 'login')).toBe(challenge)
    expect(takeChallenge(token, 'login')).toBeNull()
  })
  it('类型不匹配即失效且清除', () => {
    const { token } = storeChallenge('register')
    expect(takeChallenge(token, 'login')).toBeNull()
    expect(challengeMap.has(token)).toBe(false)
  })
  it('过期挑战返回 null', () => {
    const { token } = storeChallenge('login')
    // 直接篡改过期时间（单测可控）
    const entry = challengeMap.get(token)!
    entry.expiresAt = Date.now() - 1
    expect(takeChallenge(token, 'login')).toBeNull()
    expect(challengeMap.has(token)).toBe(false)
  })
})
