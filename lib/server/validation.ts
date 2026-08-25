import { z } from 'zod'

const locationFields = {
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  locationAccuracy: z.number().min(0).max(10_000).nullable().optional(),
}

const encryptedPayload = {
  ciphertext: z.string().min(1).max(300_000),
  iv: z.string().min(1).max(64),
  encryptionVersion: z.number().int().min(1).max(10).default(1),
}

// 明确拒绝客户端传 id/created_at/updated_at（strict 模式会拒绝未知键）
export const diaryCreateSchema = z
  .strictObject({ ...encryptedPayload, timezone: z.string().max(64).nullable().optional(), ...locationFields })
export const diaryUpdateSchema = z
  .strictObject({
    ciphertext: z.string().min(1).max(300_000).optional(),
    iv: z.string().min(1).max(64).optional(),
    encryptionVersion: z.number().int().min(1).max(10).optional(),
    timezone: z.string().max(64).nullable().optional(),
    ...locationFields,
  })
export const draftPutSchema = z.strictObject({ ...encryptedPayload, timezone: z.string().max(64).nullable().optional() })
export const wrapperSchema = z.strictObject({
  wrapperType: z.enum(['passkey_prf', 'recovery']),
  credentialId: z.string().min(1).max(512).optional(), // recovery 不需要
  encryptedDek: z.string().min(1).max(2048),
  salt: z.string().min(1).max(256),
  encryptionVersion: z.number().int().min(1).max(10).default(1),
  recoveryKeyHash: z.string().length(64).optional(), // 仅 recovery
})
