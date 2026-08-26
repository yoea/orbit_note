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

let parsed: z.infer<typeof envSchema>
try {
  parsed = envSchema.parse(process.env)
} catch (e) {
  if (e instanceof z.ZodError) {
    const missing = e.issues.map((i) => i.path.join('.')).join(', ')
    throw new Error(`环境变量缺失或无效: ${missing}。请检查 .env.local（开发）或服务器环境变量（生产）。`)
  }
  throw e
}
export const env = parsed
