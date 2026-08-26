import { toBase64 } from './base64'

// PRF eval 输入 / 输出均以 base64url（无 padding）表示
export function prfEvalB64(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
