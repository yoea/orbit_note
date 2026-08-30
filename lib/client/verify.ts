import { authenticatePasskey } from './webauthn'

// 通行密钥在场验证：WebAuthn 认证 + 服务端验签（成功才视为通过）。
// 用于导出笔记、删除数据等敏感操作的二次确认（与登录同一套认证链路）。
export async function verifyWithPasskey(): Promise<boolean> {
  try {
    const optsRes = await fetch('/api/auth/login/options')
    if (!optsRes.ok) return false
    const { token, options } = await optsRes.json()
    const { assertion } = await authenticatePasskey(options, null) // 仅认证，不需要 PRF
    const loginRes = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, assertion }),
    })
    return loginRes.ok
  } catch {
    return false // 用户取消/认证失败
  }
}

// 恢复密钥验证：服务器 SHA-256 校验（通过即视为身份确认）
export async function verifyWithRecoveryKey(recoveryKey: string): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/recovery-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recoveryKey }),
    })
    return res.ok
  } catch {
    return false
  }
}
