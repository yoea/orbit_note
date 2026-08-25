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
  const challenge = crypto.randomUUID() + crypto.randomUUID()
  const token = crypto.randomUUID()
  challengeMap.set(token, { challenge, type, expiresAt: Date.now() + 60_000 })
  return { token, challenge }
}

export function takeChallenge(token: string, type: 'register' | 'login'): string | null {
  const entry = challengeMap.get(token)
  if (!entry || entry.type !== type || entry.expiresAt < Date.now()) return null
  challengeMap.delete(token)
  return entry.challenge
}

export async function generateRegisterOptions() {
  return generateRegistrationOptions({
    rpName,
    rpID,
    userName: 'owner',
    userDisplayName: 'Owner',
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
    userVerification: 'required',
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
  })
}
