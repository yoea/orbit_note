import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  WEBAUTHN_RP_ID: z.string().min(1),
  WEBAUTHN_RP_NAME: z.string().min(1),
  WEBAUTHN_ORIGIN: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  RECOVERY_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

export const env = envSchema.parse(process.env)
