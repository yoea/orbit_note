import {
  bigint, check, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const credentials = pgTable('credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: text('public_key').notNull(),
  counter: bigint('counter', { mode: 'number' }).notNull().default(0),
  transports: jsonb('transports').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
})

// 密钥包装表：每个 credential 一个 PRF wrapper + 一个 recovery wrapper（多行）
export const keyWrappers = pgTable('key_wrappers', {
  id: uuid('id').primaryKey().defaultRandom(),
  wrapperType: text('wrapper_type').notNull(), // 'passkey_prf' | 'recovery'
  credentialId: text('credential_id'), // passkey_prf 时有值；recovery 为 null
  encryptedDek: text('encrypted_dek').notNull(),
  salt: text('salt').notNull(), // passkey_prf: PRF eval 输入 S；recovery: 随机 salt_r
  encryptionVersion: integer('encryption_version').notNull().default(1),
  // 仅 recovery 行：SHA-256(recovery key) 十六进制，用于灾难恢复登录校验（Task 8 使用）
  recoveryKeyHash: text('recovery_key_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('key_wrappers_wrapper_type_check', sql`${t.wrapperType} in ('passkey_prf', 'recovery')`),
  // 每个 credential 最多一个 PRF wrapper
  uniqueIndex('key_wrappers_prf_unique').on(t.wrapperType, t.credentialId).where(sql`${t.wrapperType} = 'passkey_prf'`),
  // recovery wrapper 全局唯一（单行）
  uniqueIndex('key_wrappers_recovery_unique').on(t.wrapperType).where(sql`${t.wrapperType} = 'recovery'`),
])

export const diaryEntries = pgTable('diary_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  encryptionVersion: integer('encryption_version').notNull().default(1),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  locationAccuracy: doublePrecision('location_accuracy'),
  timezone: text('timezone'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // 列表 API 按 created_at desc 排序
  index('diary_entries_created_at_idx').on(t.createdAt),
])

// 单行草稿（单用户）
export const drafts = pgTable('drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  encryptionVersion: integer('encryption_version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
