import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/server/db/schema.ts',
  out: './drizzle',
  // drizzle-kit CLI 自身会加载 .env；迁移工具链只依赖 DATABASE_URL，与 WebAuthn/session 配置解耦
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
})
