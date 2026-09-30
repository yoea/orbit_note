import {
  bigint, boolean, check, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const credentials = pgTable('credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: text('public_key').notNull(),
  counter: bigint('counter', { mode: 'number' }).notNull().default(0),
  transports: jsonb('transports').$type<string[]>().notNull().default([]),
  // 注册时客户端上报的设备标识（明文元数据，仅用于设置页区分是哪台设备）
  device: text('device'),
  // 软禁用标记：禁用后无法登录，可随时重新启用（不删除凭证与 PRF wrapper）
  disabled: boolean('disabled').notNull().default(false),
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
  // ── 结构化地名（省 / 市 / 区）─────────────────────────────────────────────
  // 反查接口（BigDataCloud）本来就**分级**返回（principalSubdivision / city / locality），
  // 早先把它拼成一个「区 市」字符串是**有损**的：既分不出「昆明」是市还是区，
  // 也没法按「省」或「市」筛选。三级各自一列，缺失的级为 null（市辖区/国外地址常有缺级）。
  locationProvince: text('location_province'),
  locationCity: text('location_city'),
  locationDistrict: text('location_district'),
  // ★ 旧字段（已废弃）：单一地名串（如「五华区 昆明市」）。
  //   只有本功能上线**之前**写入的老数据会有值；写路径不再产生它
  //   （见 app/api/diary/[id]/route.ts：写入结构化三级时顺手清空它）。
  //   读路径只作为展示兜底（lib/client/location.ts 的 displayLocationName），
  //   老条目被打开时会自动重新反查并升级成结构化三级。
  locationName: text('location_name'),
  // 保存时和风天气获取的实时天气文本（如"晴 25°C"，失败为 null 不显示）
  weather: text('weather'),
  timezone: text('timezone'),
  // 解密时计算的字数（列表/统计无需解密即可显示）
  wordCount: integer('word_count').notNull().default(0),
  // 「收藏」（星标）：单一布尔列就够了，刻意不做多集合/多标签（本项目单用户）。
  // 与位置、天气同级：属于**明文的元数据**（不进加密范围，也不影响 updatedAt——
  // 收藏一篇不算「编辑」，详情页不会因此显示「编辑于」）。
  starred: boolean('starred').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // 列表 API 按 created_at desc 排序
  index('diary_entries_created_at_idx').on(t.createdAt),
])

// 用户偏好（设置页开关，存数据库而非 localStorage——多端同步）
export const userPrefs = pgTable('user_prefs', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// 用户资料（单行，id 固定 'owner'）：目前只存用户名。
// 名字是「可识别身份」的信息——按项目 E2EE 约定**不存明文**，由客户端用 DEK 加密后入库，
// 服务器永远拿不到真实名字（与 diary_entries 同级别的保护）。
// 行是懒创建的：用户首次进入设置页时才写入默认名 Orbit_xxx。
export const userProfile = pgTable('user_profile', {
  id: text('id').primaryKey(),
  nameCiphertext: text('name_ciphertext'),
  nameIv: text('name_iv'),
  // 注册时间：仅「首次注册（即创建账号）」时由服务端写入，之后不再改动。
  // 可空——本功能上线之前注册的老用户没有这个值，界面回退为「第一篇日记」的日期。
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// 每日提示显示统计（后续按出现频率展示用）
export const promptStats = pgTable('prompt_stats', {
  promptId: text('prompt_id').primaryKey(), // 提示索引 "p_0".."p_99"
  showCount: integer('show_count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// 单行草稿（单用户）
export const drafts = pgTable('drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  encryptionVersion: integer('encryption_version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
