import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      // 与 tsconfig paths 的 "@/*": ["./*"] 保持一致（route handler 测试需要）
      '@': fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]+$/, ''),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // env.ts 在 import 时即 parse process.env，测试环境必须显式提供
    env: {
      DATABASE_URL: 'postgres://localhost:5432/quiet_orbit_test',
      WEBAUTHN_RP_ID: 'localhost',
      WEBAUTHN_RP_NAME: 'Quiet Orbit Test',
      WEBAUTHN_ORIGIN: 'http://localhost:3000',
      SESSION_SECRET: 'test-secret-'.repeat(5),
      RECOVERY_KEY_VERSION: '1',
      NODE_ENV: 'test',
    },
  },
})
