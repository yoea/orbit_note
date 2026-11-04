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
const PROFILE = 'lib/client/profile.ts'

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
    expect(src, '缺大小上限').toMatch(/MAX_BYTES\s*=\s*400\s*\*\s*1024/)
    expect(src, '缺类型白名单').toMatch(/'image\/webp'/)
    // ★ 必须收 PNG：iOS Safari 不支持 WebP 编码时会把 canvas 输出降级成 PNG（不是返回 null），
    //   只放行 webp/jpeg 会导致每次上传都 415（2026-11-04 真机事故）。
    expect(src, '白名单没有 image/png —— iOS 会把 WebP 降级成 PNG，上传必 415').toContain("'image/png'")
    expect(src, '没有拒绝超限文件').toContain('too_large')
    expect(src, '没有拒绝非法类型').toContain('unsupported_type')
  })

  it('A6 头像弹窗必须接 useDialogBehavior（Esc / Tab 循环 / 焦点归还）', () => {
    const src = code(MANAGER)
    expect(src, '没接 useDialogBehavior').toContain('useDialogBehavior(cardRef')
    expect(src, '缺 aria-modal').toContain('aria-modal="true"')
    expect(src, '缺可读名称').toContain('aria-label=')
  })

  it('A7 客户端输出 256×256 且用全兼容的 JPEG 编码', () => {
    const src = code(MANAGER)
    expect(src, '输出尺寸不是 256').toMatch(/OUTPUT_SIZE\s*=\s*256/)
    // ★ 首选必须是 JPEG：iOS 不支持 WebP 编码时会把 canvas 输出降级成 PNG，
    //   服务端若只认 webp/jpeg 就是 415（2026-11-04 真机事故）。JPEG 全平台都有编码器。
    // ★ 断言顺序而不是「出现过」：两者都在的写法下，只断存在会被兜底那句命中（实测假绿）。
    const jpegAt = src.indexOf("toBlob('image/jpeg')")
    const webpAt = src.indexOf("toBlob('image/webp')")
    expect(jpegAt, '没有用 JPEG 编码').toBeGreaterThan(-1)
    expect(webpAt, '找不到 WebP 兜底（预期它排在 JPEG 之后）').toBeGreaterThan(-1)
    expect(jpegAt, 'JPEG 不是首选编码 —— 顺序反了就会在 iOS 上踩 415').toBeLessThan(webpAt)
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

  it('A9 读图不得提前清空 input、不得依赖 blob URL（真机「图片读取失败」的根因）', () => {
    const src = code(MANAGER)
    // 2026-11-04 事故：在解码之前 `input.value = ''`，Safari 随之回收 FileList，
    // 已拿到的 File 变成无效引用 ⇒ 解码必然失败（iOS PWA 与桌面浏览器同时复现）。
    // 清空只能出现在 finally（= 文件读完之后）。
    expect(src, '清空 input 不在 finally 里 —— 提前清空会让 Safari 回收 File').toMatch(
      /finally\s*\{[\s\S]{0,400}?value = ''/,
    )
    // ★ 再加一道：从取 file 到真正解码之间，不许出现清空（否则 finally 里那句会掩盖问题，
    //   实测「只断 finally 有清空」在把清空挪回前面时依然通过 = 假绿）。
    const start = src.indexOf('files?.[0]')
    const decodeAt = src.indexOf('buildSource(file)')
    expect(start, '找不到 files?.[0]').toBeGreaterThan(-1)
    expect(decodeAt, '找不到 buildSource(file)').toBeGreaterThan(-1)
    expect(
      src.slice(start, decodeAt),
      '在解码之前清空了 input.value —— Safari 会回收 File，解码必然失败',
    ).not.toContain("value = ''")
    // 解码路径不许再用 blob URL：它的生命周期一旦出错，表现就是「图片读取失败」。
    expect(src, '解码又用回 createObjectURL 了').not.toContain('createObjectURL')
  })

  it('A10 改完头像必须强制与服务端校准并给提示（缓存短路那个坑）', () => {
    const src = code(MANAGER)
    // 2026-11-04 事故：上传成功了但界面不更新、也无任何提示。
    // 根因一：loadUserName 命中缓存就 return，所谓的「校准」等于没做 ⇒ 必须带 force。
    // ★ 断言次数而不是「出现过」：上传与删除两条路径各要一次，只断存在会被另一条兜住（实测假绿）。
    const forced = src.match(/loadUserName\(\{ force: true \}\)/g) ?? []
    expect(forced.length, '上传 / 删除成功后都要强制校准（各一次）').toBeGreaterThanOrEqual(2)
    // 根因二：成功后没有任何反馈（用户不知道成没成）
    expect(src, '上传/删除成功后没有回调提示').toContain('onSaved?.(')

    const prof = code(PROFILE)
    expect(prof, 'loadUserName 不支持 force 参数').toMatch(/loadUserName\(opts\?:\s*\{\s*force\?:\s*boolean\s*\}/)
    expect(prof, 'loadUserName 的 force 判据没生效').toMatch(/if\s*\(cached\s*&&\s*!opts\?\.force\)/)
    // setCachedAvatar 不许在缓存还没建立时直接 return（那样换了头像界面也不会动）
    expect(prof, 'setCachedAvatar 在 cached 为空时短路了').toMatch(/const base: ProfileState = cached \?\?/)
  })
})
