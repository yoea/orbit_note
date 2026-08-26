import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { fromBase64Url, toBase64Url } from './crypto/base64'

export interface RegistrationResult {
  registration: { id?: string; clientExtensionResults?: Record<string, unknown> } & Record<string, unknown>
  prfEnabled: boolean
}

// PRF 扩展构建：eval.first 必须是 BufferSource（ArrayBuffer/ArrayBufferView）——WebAuthn L3 PRF 规范要求二进制，
// @simplewebauthn/browser 对 extensions 原样透传（不转换），传字符串会被浏览器拒绝（TypeError）。
export function buildPrfExtensions(prfEvalFirst: Uint8Array): { prf: { eval: { first: Uint8Array } } } {
  return { prf: { eval: { first: prfEvalFirst } } }
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
    extensions: {
      ...((options.extensions as Record<string, unknown>) ?? {}),
      ...buildPrfExtensions(prfEvalS),
    },
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

// PRF 输出规范化：规范要求 base64url 字符串，但部分 iOS 版本返回二进制（Uint8Array/ArrayBuffer）。
// 统一转为 base64url 字符串，避免下游 fromBase64Url 收到非字符串抛 TypeError。
export function normalizePrfResult(first: unknown): string | null {
  if (first == null) return null
  if (typeof first === 'string') return first
  if (first instanceof Uint8Array) return toBase64Url(first)
  if (first instanceof ArrayBuffer) return toBase64Url(new Uint8Array(first))
  // 类数组兜底（如平台返回普通数组）
  if (Array.isArray(first)) return toBase64Url(Uint8Array.from(first as number[]))
  return null
}

// 认证 Passkey：带 PRF eval（S 来自服务器 wrapper 的 salt，base64url 字符串——内部转回二进制）
export async function authenticatePasskey(
  options: Record<string, unknown>,
  prfEvalS: string | null,
): Promise<{ assertion: Record<string, unknown>; prfResult: string | null }> {
  const optionsJSON = prfEvalS
    ? {
        ...options,
        extensions: {
          ...((options.extensions as Record<string, unknown>) ?? {}),
          ...buildPrfExtensions(fromBase64Url(prfEvalS)),
        },
      }
    : options
  const assertion = await startAuthentication({
    optionsJSON: optionsJSON as unknown as PublicKeyCredentialRequestOptionsJSON,
  })
  const ext = assertion.clientExtensionResults as unknown as Record<string, unknown>
  const prf = ext.prf as { results?: { first?: unknown } } | undefined
  return { assertion: assertion as unknown as Record<string, unknown>, prfResult: normalizePrfResult(prf?.results?.first) }
}
