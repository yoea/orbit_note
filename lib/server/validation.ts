import { z } from 'zod'

const locationFields = {
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  locationAccuracy: z.number().min(0).max(10_000).nullable().optional(),
}

// 结构化地名三级（客户端反查后 PATCH 补写）。与坐标同级：明文的元数据，不进加密范围。
// 长度上限 64 与 weather/timezone 同量级——省/市/区名最长也就十几个汉字。
const placeFields = {
  locationProvince: z.string().max(64).nullable().optional(),
  locationCity: z.string().max(64).nullable().optional(),
  locationDistrict: z.string().max(64).nullable().optional(),
}

// 收藏（星标）。与位置、天气一样属于「纯元数据更新」：不带 ciphertext 就不会更新 updatedAt，
// 所以收藏一篇不会让详情页冒出「编辑于」（见 app/api/diary/[id]/route.ts）。
const starredField = { starred: z.boolean().optional() }

const encryptedPayload = {
  ciphertext: z.string().min(1).max(300_000),
  iv: z.string().min(1).max(64),
  encryptionVersion: z.number().int().min(1).max(10).default(1),
}

// 字数（解密时计算，明文数字——列表/统计无需解密即可显示）
const wordCountField = { wordCount: z.number().int().min(0).max(1_000_000).optional() }

// 明确拒绝客户端传 created_at/updated_at（strict 模式会拒绝未知键）。
// id 例外：离线写队列重传时由客户端生成 UUID 做幂等（重复 POST 同 id 返回已有条目，
// 网络抖动下的「不确定上次是否成功」重传不会重复入库）
export const diaryCreateSchema = z
  .strictObject({
    id: z.string().uuid().optional(),
    ...encryptedPayload,
    timezone: z.string().max(64).nullable().optional(),
    // starred 只在「离线队列冲刷」这一条路径上由客户端指定（离线时点过收藏的笔记，
    // 联网补传时要把它一起带上）；在线新建走服务端默认 false。
    ...starredField,
    ...locationFields,
    ...wordCountField,
  })
export const diaryUpdateSchema = z
  .strictObject({
    ciphertext: z.string().min(1).max(300_000).optional(),
    iv: z.string().min(1).max(64).optional(),
    encryptionVersion: z.number().int().min(1).max(10).optional(),
    timezone: z.string().max(64).nullable().optional(),
    // 旧的单一地名串。**保留**是为了让还没更新的客户端（PWA 缓存的旧包）仍能补写地点名，
    // 新版客户端一律走 placeFields。服务端在结构化三级出现时会把它清空。
    locationName: z.string().max(255).nullable().optional(),
    weather: z.string().max(64).nullable().optional(), // 客户端天气查询后补写
    ...starredField,
    ...placeFields,
    ...locationFields,
    ...wordCountField,
  })

  .refine((d) => (d.ciphertext === undefined) === (d.iv === undefined), {
    message: 'ciphertext 与 iv 必须成对更新',
  })
  .refine((d) => Object.keys(d).length > 0, { message: '更新内容不能为空' })

// 导入（批量写路径）：**故意**与 diaryCreateSchema 不同——
// 1) 允许客户端指定 createdAt/updatedAt：备份/迁移必须保留原始时间，否则整批日记会挤在导入那一刻；
// 2) 允许直接带 weather / locationName / locationAccuracy：导入时不该再触发一轮外部反查
//    （既慢，又依赖第三方 API 可用）；
// 3) id 必填（导入客户端用 UUIDv5 确定性派生 ⇒ 同一份文件重复导入天然幂等）。
// 时间用 Date.parse 做可解析性校验，不依赖 zod 的 datetime 格式器（版本差异大）。
const isoDate = z
  .string()
  .min(1)
  .max(40)
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: '时间格式无法解析' })

export const diaryImportEntrySchema = z.strictObject({
  id: z.string().uuid(),
  ciphertext: z.string().min(1).max(300_000),
  iv: z.string().min(1).max(64),
  encryptionVersion: z.number().int().min(1).max(10).default(1),
  locationName: z.string().max(255).nullable().optional(),
  weather: z.string().max(64).nullable().optional(),
  timezone: z.string().max(64).nullable().optional(),
  ...starredField,
  ...placeFields,
  ...locationFields,
  ...wordCountField,
  createdAt: isoDate,
  updatedAt: isoDate,
})

// 单批上限：客户端按体积自适应分批（约 50 条/请求），这里只是防呆上限。
export const MAX_IMPORT_BATCH = 200
export const draftPutSchema = z.strictObject({ ...encryptedPayload, updatedAt: z.number().int().positive().optional() })

// 用户名（密文入库，客户端 DEK 加密；服务器只见密文）
export const PROFILE_OWNER_ID = 'owner'
export const profilePutSchema = z.strictObject({
  nameCiphertext: z.string().min(1).max(2048),
  nameIv: z.string().min(1).max(64),
})
export const wrapperSchema = z
  .strictObject({
    wrapperType: z.enum(['passkey_prf', 'recovery']),
    credentialId: z.string().min(1).max(512).optional(), // recovery 不需要
    encryptedDek: z.string().min(1).max(2048),
    // 编码约定：标准 base64 或 base64url 均可（derivePrfKek 内规范化）；格式校验仅收合法字符集
    salt: z.string().min(1).max(256).regex(/^[A-Za-z0-9+/_-]+={0,2}$/),
    encryptionVersion: z.number().int().min(1).max(10).default(1),
    recoveryKeyHash: z.string().length(64).regex(/^[0-9a-f]+$/).optional(), // 仅 recovery
  })
  .superRefine((d, ctx) => {
    if (d.wrapperType === 'passkey_prf' && !d.credentialId) {
      ctx.addIssue({ code: 'custom', message: 'passkey_prf wrapper 必须包含 credentialId' })
    }
    if (d.wrapperType === 'passkey_prf' && d.recoveryKeyHash) {
      ctx.addIssue({ code: 'custom', message: 'passkey_prf wrapper 不能包含 recoveryKeyHash' })
    }
    if (d.wrapperType === 'recovery' && !d.recoveryKeyHash) {
      ctx.addIssue({ code: 'custom', message: 'recovery wrapper 必须包含 recoveryKeyHash' })
    }
    if (d.wrapperType === 'recovery' && d.credentialId) {
      ctx.addIssue({ code: 'custom', message: 'recovery wrapper 不能包含 credentialId' })
    }
  })
