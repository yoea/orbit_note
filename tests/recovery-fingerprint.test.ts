// 守卫：恢复密钥的「辨认信息」只能是指纹，绝不能是明文或完整哈希。
//
// 背景（2026-10-29 用户要求）：
//   「重做恢复密钥页面：评估『仅展示开头 3 个字符和结尾 3 个字符，中间用 6 个 * 代替』是否安全，
//     若不安全则提出更稳妥的最小信息暴露方案（例如缩短可见片段、增加掩码或改用不可还原的
//     指纹，同时保留创建时间）；页面需正确展示当前恢复密钥的掩码片段及其创建时间，
//     且不能泄露或可被轻易推测出完整密钥。」
//
// 评估结论（已与用户确认走「哈希短指纹」）：
//   · 恢复密钥 = 43 字符 base64url，32 字节 CSPRNG ⇒ 256 bit 熵；
//     「头 3 尾 3」= 暴露 36 bit、剩余 220 bit ⇒ 密码学上不可爆破，**但**服务端只有
//     SHA-256 哈希、要显示明文片段就得**新增一列持久化 6 个明文字符**，等于把
//     「服务端零明文密钥材料」打开一个口子，且存量密钥无片段需兜底、重生成还要同步更新。
//   · 改用**不可还原的短指纹**：SHA-256 哈希前 8 位（32 bit），零明文片段落库、零迁移，
//     顺带把「完整 64 位哈希下发到前端（含写入 IndexedDB 离线缓存）」这个既有暴露面收掉。
//
// 本文件把三条钉死：
//   ① GET /api/keys/wrappers 不下发完整 recoveryKeyHash，只给 8 位指纹 + createdAt；
//   ② 换新密钥时刷新 createdAt（否则「创建时间」永远停在首次初始化）；
//   ③ 弹窗展示的是指纹 + 创建时间，且**不含任何明文片段**。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot, stripComments } from './class-attrs'

function code(rel: string): string {
  return stripComments(readFileSync(join(projectRoot, rel), 'utf8'))
}

describe('恢复密钥：只暴露指纹 + 创建时间', () => {
  it('R1 GET /api/keys/wrappers 剥掉完整哈希，只下发 8 位指纹', () => {
    const src = code('app/api/keys/wrappers/route.ts')
    const at = src.indexOf('export async function GET')
    expect(at, '找不到 GET 路由').toBeGreaterThan(-1)
    const body = src.slice(at, src.indexOf('export async function POST'))
    // 完整哈希必须被**解构剔除**（不进响应体），且响应里不得出现哈希字段
    expect(body, '没有把 recoveryKeyHash 从结果里剔除').toContain('({ recoveryKeyHash, ...rest })')
    expect(body, '响应里出现了 recoveryKeyHash 字段').not.toContain('recoveryKeyHash:')
    expect(body, '响应里没有派生指纹').toContain('recoveryKeyFingerprint')
    // 指纹 = 哈希前 8 位（派生值，不是另存一列）
    expect(body, '指纹不是取哈希前 8 位').toContain('recoveryKeyHash.slice(0, 8)')
  })

  it('R2 换新密钥时刷新 createdAt（创建时间要等于「当前这把」的创建时刻）', () => {
    const src = code('app/api/keys/wrappers/recovery/route.ts')
    const at = src.indexOf('.set({')
    expect(at, '找不到 update 的 set').toBeGreaterThan(-1)
    const body = src.slice(at, at + 220)
    expect(body, '换新密钥没有刷新 createdAt').toContain('createdAt: new Date()')
  })

  it('R3 弹窗展示的是指纹 + 创建时间，不含明文片段', () => {
    const src = code('components/RecoveryRegenerateDialog.tsx')
    expect(src, '弹窗没有展示创建时间').toContain('keyInfo.createdAt')
    expect(src, '弹窗没有展示指纹').toContain('keyInfo.fingerprint')
    expect(src, '指纹没有格式化成「XXXX-XXXX」').toContain('formatFingerprint')
    // 反面：不得出现「头 3 尾 3 + 星号」那种明文片段展示
    expect(src, '恢复密钥弹窗里出现了明文片段展示').not.toMatch(/slice\(0,\s*3\)/)
    expect(src, '恢复密钥弹窗里出现了星号掩码').not.toContain('******')
  })

  it('R4 客户端类型带上指纹与创建时间（前端不再靠隐式字段）', () => {
    const src = code('lib/client/types.ts')
    expect(src, '类型里没有指纹字段').toContain('recoveryKeyFingerprint')
    expect(src, '类型里没有创建时间字段').toContain('createdAt')
  })
})
