import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { prfEvalB64 } from './crypto/prf'

export interface RegistrationResult {
  registration: { id?: string; clientExtensionResults?: Record<string, unknown> } & Record<string, unknown>
  prfEnabled: boolean
}

// 注册 Passkey：注入 PRF 扩展（eval first = S）。clientExtensionResults.prf.enabled 表示 PRF 是否被 authenticator 支持
// 注：@simplewebauthn/browser 13.x 的类型（AuthenticationExtensionsClientInputs/Outputs）尚未内置 PRF 扩展字段，
// 故此处以 Record<string, unknown> 表示 options，并在边界处显式断言（运行时结构符合 WebAuthn PRF 扩展规范）
export async function registerPasskey(
  options: Record<string, unknown>,
  prfEvalS: Uint8Array,
): Promise<RegistrationResult> {
  const optionsJSON = {
    ...options,
    extensions: { prf: { eval: { first: prfEvalB64(prfEvalS) } } },
  }
  const registration = await startRegistration({
    optionsJSON: optionsJSON as unknown as PublicKeyCredentialCreationOptionsJSON,
  })
  const ext = registration.clientExtensionResults as unknown as Record<string, unknown>
  const prf = ext.prf as { enabled?: boolean } | undefined
  return {
    registration: registration as unknown as RegistrationResult['registration'],
    prfEnabled: Boolean(prf?.enabled),
  }
}

// 认证 Passkey：带 PRF eval（S 来自服务器 wrapper 的 salt 或本地已知值）
export async function authenticatePasskey(
  options: Record<string, unknown>,
  prfEvalS: string | null,
): Promise<{ assertion: Record<string, unknown>; prfResult: string | null }> {
  const optionsJSON = prfEvalS ? { ...options, extensions: { prf: { eval: { first: prfEvalS } } } } : options
  const assertion = await startAuthentication({
    optionsJSON: optionsJSON as unknown as PublicKeyCredentialRequestOptionsJSON,
  })
  const ext = assertion.clientExtensionResults as unknown as Record<string, unknown>
  const prf = ext.prf as { results?: { first?: string } } | undefined
  return { assertion: assertion as unknown as Record<string, unknown>, prfResult: prf?.results?.first ?? null }
}
