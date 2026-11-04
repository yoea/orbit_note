import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot, stripComments } from './class-attrs'

// ============================================================================
// 头像功能守卫
//
// 关键约束（每条都是踩过或会踩的坑）：
//   1. **对象前缀必须是 `orbit/`** —— RAM 子账号的策略只授
//      `acs:oss:*:*:ethan-orbit/orbit/*`，key 跑出这个前缀就是 AccessDenied。
//   2. **头像 key 固定**（`orbit/avatar/current`）—— 每次换图换 key 会在 bucket 里
//      堆一堆几 KB 的垃圾对象，还得额外写清理逻辑。
//   3. **只存 key，不存 URL** —— bucket 是私有的，URL 是每次签名的临时地址；
//      把签名 URL 落库，一天后就全变成 403。
//   4. **上传走内网、签名走公网** —— 内网域名（*-internal）在公网解析不了，
//      签出来的 URL 浏览器打不开；反过来上传走公网就白付流量费。
//   5. **API 三道闸 + 大小/类型白名单** —— 否则就成了免费图床。
// ============================================================================

const SCHEMA = 'lib/server/db/schema.ts'
const OSS = 'lib/server/oss.ts'
const API = 'app/api/avatar/route.ts'
const MIGRATION = 'drizzle/0016_add_avatar.sql'
const MANAGER = 'components/AvatarManager.tsx'

function code(rel: string): string {
  return stripComments(readFileSync(join(projectRoot, rel), 'utf8'))
}

describe('头像：存储与权限', () => {
  it('A0 自检：关键文件都读得到（否则后面全是空转）', () => {
    for (const rel of [SCHEMA, OSS, API, MANAGER, MIGRATION]) {
      expect(existsSync(join(projectRoot, rel)), `${rel} 不存在`).toBe(true)
      expect(code(rel).length, `${rel} 内容过短，多半读错了`).toBeGreaterThan(200)
    }
  })

  it('A1 迁移与 schema 都有 avatar_key / avatar_updated_at', () => {
    const sql = code(MIGRATION)
    expect(sql, '迁移缺 avatar_key').toMatch(/ADD COLUMN IF NOT EXISTS avatar_key/)
    expect(sql, '迁移缺 avatar_updated_at').toMatch(/ADD COLUMN IF NOT EXISTS avatar_updated_at/)
    const sch = code(SCHEMA)
    expect(sch, 'schema 缺 avatarKey 字段').toContain("avatarKey: text('avatar_key')")
    expect(sch, 'schema 缺 avatarUpdatedAt 字段').toContain("avatarUpdatedAt: timestamp('avatar_updated_at'")
  })

  it('A2 只存 key，不存 URL（签名 URL 会过期，落库就是死链）', () => {
    const sch = code(SCHEMA)
    expect(sch, 'schema 里出现了 avatarUrl —— 签名地址不能落库').not.toMatch(/avatarUrl/)
  })

  it('A3 对象前缀必须是 orbit/，且头像 key 固定（不堆积垃圾对象）', () => {
    const src = code(OSS)
    expect(src, "OSS_PREFIX 不是 'orbit/' —— RAM 策略只授这个前缀").toMatch(/OSS_PREFIX\s*=\s*'orbit\/'/)
    expect(src, '头像 key 不是固定路径').toMatch(/AVATAR_KEY\s*=\s*`\$\{OSS_PREFIX\}avatar\/current`/)
    // 反向：头像 key 里不许掺随机 id / 时间戳
    const avatarLine = src.split('\n').find((l) => l.includes('AVATAR_KEY')) ?? ''
    expect(avatarLine, '头像 key 里混进了随机值 —— 每次换图都会留一个孤儿对象').not.toMatch(/randomUUID|Date\.now/)
  })

  it('A4 上传用内网 endpoint、签名用公网 endpoint（反过来都不可用）', () => {
    const src = code(OSS)
    // 两个 client 各自绑定正确 endpoint
    expect(src, '上传 client 没用内网 endpoint').toMatch(/getUploadClient[\s\S]{0,300}endpoint:\s*INTERNAL_ENDPOINT/)
    expect(src, '签名 client 没用公网 endpoint').toMatch(/getSignClient[\s\S]{0,300}endpoint:\s*PUBLIC_ENDPOINT/)
    // 反向：签名绝不能落在内网 client 上
    expect(src, 'signatureUrl 用在了内网 client 上 —— 签出来的地址浏览器打不开').not.toMatch(
      /getUploadClient\(\)\.signatureUrl/,
    )
  })
})

describe('头像：接口与交互', () => {
  it('A5 API 三道闸齐全，且有大小/类型白名单', () => {
    const src = code(API)
    expect(src, '缺 requireAuth').toContain('requireAuth(req)')
    expect(src, '缺同源校验').toContain('assertSameOrigin(req)')
    expect(src, '缺限流').toMatch(/rateLimit\('avatar'/)
    expect(src, '缺大小上限').toMatch(/MAX_BYTES\s*=\s*200\s*\*\s*1024/)
    expect(src, '缺类型白名单').toMatch(/'image\/webp'/)
    expect(src, '没有拒绝超限文件').toContain('too_large')
    expect(src, '没有拒绝非法类型').toContain('unsupported_type')
  })

  it('A6 头像弹窗必须接 useDialogBehavior（Esc / Tab 循环 / 焦点归还）', () => {
    const src = code(MANAGER)
    expect(src, '没接 useDialogBehavior').toContain('useDialogBehavior(cardRef')
    expect(src, '缺 aria-modal').toContain('aria-modal="true"')
    expect(src, '缺可读名称').toContain('aria-label=')
  })

  it('A7 客户端输出 256×256 的 WebP（体积换成本的关键）', () => {
    const src = code(MANAGER)
    expect(src, '输出尺寸不是 256').toMatch(/OUTPUT_SIZE\s*=\s*256/)
    expect(src, '没有编码成 WebP').toContain("'image/webp'")
    expect(src, '没有走 canvas 裁剪就直接上传了原图').toContain('drawImage')
  })

  it('A8 裁剪自己画 canvas，不依赖第三方裁剪库（真机上黑屏那次）', () => {
    const src = code(MANAGER)
    // 2026-11-04：react-easy-crop 在真机上「取景框全黑、拖不动、滑块无反应」，
    // 样式确认已打包（9 个类都在产物里），问题在库内部的媒体加载时序，此处无法定位 ⇒ 自绘。
    expect(src, '又引回第三方裁剪库了').not.toContain('react-easy-crop')
    // ★ 断言必须钉到 JSX 上的**实际绑定**：只查 /onPointerDown/ 会被函数定义本身兜住（假绿，实测）。
    expect(src, 'canvas 没绑定 pointerdown 拖动').toContain('onPointerDown={onPointerDown}')
    expect(src, 'canvas 没绑定 pointermove').toContain('onPointerMove={onPointerMove}')
    // 取景区必须禁掉浏览器手势，否则拖动会和页面滚动打架（touch-none 落在 canvas 的 class 上）
    expect(src, '取景区没禁 touch-action').toContain('touch-none')
  })
})
