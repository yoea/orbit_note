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

// 字数（解密时计算，明文数字——列表/统计无需解密即可显示）
const wordCountField = { wordCount: z.number().int().min(0).max(1_000_000).optional() }

// 明确拒绝客户端传 created_at/updated_at（strict 模式会拒绝未知键）。
// id 例外：离线写队列重传时由客户端生成 UUID 做幂等（重复 POST 同 id 返回已有条目，
// 网络抖动下的「不确定上次是否成功」重传不会重复入库）
export const diaryCreateSchema = z
  .strictObject({ id: z.string().uuid().optional(), ...encryptedPayload, timezone: z.string().max(64).nullable().optional(), ...locationFields, ...wordCountField })
export const diaryUpdateSchema = z
  .strictObject({
    ciphertext: z.string().min(1).max(300_000).optional(),
    iv: z.string().min(1).max(64).optional(),
    encryptionVersion: z.number().int().min(1).max(10).optional(),
    timezone: z.string().max(64).nullable().optional(),
    locationName: z.string().max(255).nullable().optional(), // 客户端反查后补写
    weather: z.string().max(64).nullable().optional(), // 客户端天气查询后补写
    ...locationFields,
    ...wordCountField,
  })
  .refine((d) => (d.ciphertext === undefined) === (d.iv === undefined), {
    message: 'ciphertext 与 iv 必须成对更新',
  })
  .refine((d) => Object.keys(d).length > 0, { message: '更新内容不能为空' })
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
