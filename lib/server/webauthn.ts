import 'server-only'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type {
  AuthenticatorTransportFuture,
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server'
import { env } from './env'

export const rpID = env.WEBAUTHN_RP_ID
export const rpName = env.WEBAUTHN_RP_NAME
export const origin = env.WEBAUTHN_ORIGIN

// challenge 内存存储：token -> {challenge, type, expiresAt}（TTL 60s，单用户足够）
export const challengeMap = new Map<string, { challenge: string; type: 'register' | 'login'; expiresAt: number }>()

export function storeChallenge(type: 'register' | 'login'): { token: string; challenge: string } {
  for (const [key, value] of challengeMap) {
    if (value.expiresAt < Date.now()) challengeMap.delete(key)
  }
  const challenge = crypto.randomUUID() + crypto.randomUUID()
  const token = crypto.randomUUID()
  challengeMap.set(token, { challenge, type, expiresAt: Date.now() + 60_000 })
  return { token, challenge }
}

export function takeChallenge(token: string, type: 'register' | 'login'): string | null {
  const entry = challengeMap.get(token)
  if (!entry) return null
  challengeMap.delete(token)
  if (entry.type !== type || entry.expiresAt < Date.now()) return null
  return entry.challenge
}

export async function generateRegisterOptions() {
  return generateRegistrationOptions({
    rpName,
    rpID,
    userName: 'orbit_user',
    userDisplayName: 'Orbit User',
    userID: new TextEncoder().encode('quiet-orbit-owner'),
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
      authenticatorAttachment: 'platform',
    },
    supportedAlgorithmIDs: [-7, -257],
    timeout: 60_000,
  })
}

export async function verifyRegistration(registration: RegistrationResponseJSON, expectedChallenge: string) {
  return verifyRegistrationResponse({
    response: registration,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  })
}

export async function generateLoginOptions(allowCredentials: { id: string; transports: AuthenticatorTransportFuture[] }[]) {
  return generateAuthenticationOptions({
    rpID,
    allowCredentials,
    // preferred：iOS 先唤起系统通行密钥弹窗（半屏），用户点击通行密钥后系统才唤醒 Face ID——
    // 避免 required 下"弹窗出现即自动识别"（用户未准备时识别无效需重试）。
    // 服务器侧 verifyLogin 已放宽 requireUserVerification（Windows Hello UV 兼容），
    // 无 UV 的 assertion 仍通过 passkey 签名验证（密钥在安全硬件内，需设备已解锁）。
    userVerification: 'preferred',
    timeout: 60_000,
  })
}

export async function verifyLogin(
  assertion: AuthenticationResponseJSON,
  expectedChallenge: string,
  credential: WebAuthnCredential,
) {
  return verifyAuthenticationResponse({
    response: assertion,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential,
    // Windows Hello 平台行为：系统已解锁时 credentials.get 返回的 authenticatorData UV flag = 0
    // （create 时总是 UV，get 时可能跳过重新验证）。注册仍强制 UV（创建凭证必须生物识别）；
    // 登录放宽 UV 但保留 UP（用户在场）校验——威胁模型：需要设备已解锁 + 浏览器交互才能认证，
    // 对单用户私人日记可接受（iPhone Face ID 不受影响，UV 照常置位）。
    requireUserVerification: false,
  })
}
