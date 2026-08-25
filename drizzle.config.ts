import { defineConfig } from 'drizzle-kit'
import { env } from './lib/server/env'

export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: env.DATABASE_URL },
})
