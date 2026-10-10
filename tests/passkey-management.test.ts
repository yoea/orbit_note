import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PASSKEY_FALLBACK_NAME, buildPasskeyUserNames } from '@/lib/server/passkey-name'

// ============================================================================
// 通行密钥管理守卫（2026-10-10）
//
// 三件事各守一组：
//   1. 命名 —— 有用户名 →「Ethan的Orbit」；没有 →「Orbit_User」（用户要求）；
//   2. 删除 —— 已禁用的钥匙要能**彻底删掉**（不只是启用），且删除必须同时清掉 PRF wrapper；
//   3. 半截钥匙 —— 注册流程只跑到「服务器已登记」就中断时，那把钥匙**认证能过但解不开日记**。
//      必须：登录时给出明确原因（而不是静默切恢复密钥）、列表里标成「未完成」、可删除，
//      并且添加流程自己负责清理。用户报的原话是「验证之后没反应」。
//
// 断言前一律剥注释（否则「勿改回去」这类说明文字本身会把断言打红）。
// ============================================================================

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

function code(rel: string): string {
  return readFileSync(join(projectRoot, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** 取锚点位置并**先断言它存在**：indexOf 未命中返回 -1，而 -1 小于任何正数，
 *  于是所有「先后顺序」断言会在目标被删掉时反而通过（本项目踩过的坑）。 */
function pos(src: string, needle: string): number {
  const i = src.indexOf(needle)
  expect(i, `找不到锚点：${needle}`).toBeGreaterThanOrEqual(0)
  return i
}

/** 取两个锚点之间的片段（不含右界）——用于「这段逻辑确实写在那个分支里」的断言。
 *  ★ 右界必须是**唯一的、且在该分支之后**的锚点，否则切片会跨过整个文件造成空转。 */
function between(src: string, start: string, end: string): string {
  const a = pos(src, start)
  const b = src.indexOf(end, a)
  expect(b, `右界锚点「${end}」不在「${start}」之后 —— 切片会空转`).toBeGreaterThan(a)
  return src.slice(a, b)
}

const REGISTER_OPTIONS = 'app/api/auth/register/options/route.ts'
const WEBAUTHN = 'lib/server/webauthn.ts'
const ADD_PANEL = 'components/AddPasskeyPanel.tsx'
const DIALOG = 'components/PasskeysDialog.tsx'
const LIST_ROUTE = 'app/api/keys/passkeys/route.ts'
const PURGE_ROUTE = 'app/api/keys/passkeys/[id]/purge/route.ts'
const SESSION = 'lib/client/session.ts'
const LOGIN_PAGE = 'app/login/page.tsx'
const UNLOCK_HOOK = 'lib/client/use-require-unlock.ts'

const utf8 = (s: string) => new TextEncoder().encode(s).length

// ============================================================================
// 一、命名
// ============================================================================
describe('通行密钥命名（X的Orbit / Orbit_User）', () => {
  it('N1 命名规则（直接单测纯函数）', () => {
    // 纯函数文件刻意不带 'server-only'，就是为了能被真正单测 —— webauthn.ts 顶层读 env，
    // import 即抛错，只能做源码断言。
    expect(buildPasskeyUserNames(null)).toEqual({ name: PASSKEY_FALLBACK_NAME, displayName: PASSKEY_FALLBACK_NAME })
    expect(buildPasskeyUserNames('')).toEqual({ name: PASSKEY_FALLBACK_NAME, displayName: PASSKEY_FALLBACK_NAME })
    expect(buildPasskeyUserNames('   ')).toEqual({ name: PASSKEY_FALLBACK_NAME, displayName: PASSKEY_FALLBACK_NAME })
    expect(PASSKEY_FALLBACK_NAME, '没有用户名时的兜底名（用户指定）').toBe('Orbit_User')

    // 有用户名 →「X的Orbit」。中文**允许**（displayName 无限制；user.name 限 64 字节，中文 3 字节/字）
    expect(buildPasskeyUserNames('Ethan')).toEqual({ name: 'Ethan的Orbit', displayName: 'Ethan的Orbit' })
    expect(buildPasskeyUserNames('小明')).toEqual({ name: '小明的Orbit', displayName: '小明的Orbit' })
    expect(buildPasskeyUserNames('  Ethan  ').displayName, '两边空白要裁掉').toBe('Ethan的Orbit')

    // 超 64 字节才回退 ASCII（displayName 仍保留完整名字）
    const long = 'x'.repeat(100)
    const r = buildPasskeyUserNames(long)
    expect(utf8(r.name), 'user.name 必须回到 64 字节以内（WebAuthn 规范）').toBeLessThanOrEqual(64)
    expect(r.name, 'ASCII 名超长时用「X\'s Orbit」形式').toContain("'s Orbit")
    expect(r.displayName.length, 'displayName 不该被截断').toBeGreaterThan(64)

    // 超长的纯中文名：ASCII 部分为空 ⇒ 回退固定名（但仍保留中文 displayName）
    const cn = buildPasskeyUserNames('很长的中文名字'.repeat(8))
    expect(cn.name).toBe(PASSKEY_FALLBACK_NAME)
    expect(cn.displayName).toContain('的Orbit')
  })

  it('N2 注册选项用它生成 userName / userDisplayName，且 userID 保持固定', () => {
    const wa = code(WEBAUTHN)
    expect(wa, '注册选项没有使用命名纯函数').toContain('const { name, displayName } = buildPasskeyUserNames(displayBase)')
    expect(wa).toContain('userName: name')
    expect(wa).toContain('userDisplayName: displayName')
    // userID 是「同一用户」的标识：改它会让系统通行密钥列表里多出一个孤立账户
    expect(wa, 'userID 必须保持固定').toContain("new TextEncoder().encode('quiet-orbit-owner')")
    expect(wa, '旧的固定账户名不该回来').not.toContain("'orbit_user'")
  })

  it('N3 客户端把用户名带进注册请求，服务端做长度与字符净化', () => {
    const opts = code(REGISTER_OPTIONS)
    expect(opts).toContain("searchParams.get('name')")
    expect(opts).toContain('generateRegisterOptions(displayName)')
    // 名字来自查询串 ⇒ 必须净化：去控制/格式字符 + 限长
    expect(opts, '没有去掉控制字符（Cc/Cf）').toMatch(/replace\(\/\[\\p\{Cc\}\\p\{Cf\}\]\/gu/)
    expect(opts, '没有限长').toContain('.slice(0, 32)')
    // 客户端侧
    expect(code(ADD_PANEL), '添加面板没有把当前用户名带过去').toContain('?name=${encodeURIComponent(userName)}')
  })
})

// ============================================================================
// 二、彻底删除（硬删除）
// ============================================================================
describe('删除通行密钥（硬删除）', () => {
  it('N4 purge 路由同时删掉凭证与它的 PRF wrapper', () => {
    const route = code(PURGE_ROUTE)
    expect(route, '缺少鉴权').toContain('requireAuth(req)')
    expect(route, '缺少同源校验').toContain('assertSameOrigin(req)')
    // ★ 只删 credential 会留下一条永远解不开的 wrapper（它的 PRF 输出只存在于那把钥匙里）
    expect(route, '没有删 wrapper').toContain('await db.delete(keyWrappers).where(eq(keyWrappers.credentialId, cred.credentialId))')
    expect(route, '没有删凭证').toContain('await db.delete(credentials).where(eq(credentials.id, cred.id))')
    expect(pos(route, 'await db.delete(keyWrappers).where'), '顺序：先按 credentialId 删 wrapper，再删凭证').toBeLessThan(
      pos(route, 'await db.delete(credentials).where'),
    )
  })

  it('N5 purge 按 uuid 形状分支查询（不能把两种 id 塞进一个 or()）', () => {
    // id 既可能是 credentials.id（uuid），也可能是 credentialId（base64url，添加流程自清理用）。
    // ⚠️ id 不是合法 uuid 时，PG 对 uuid 列比较会直接报 22P02 —— 所以必须分支，不能 or()。
    const route = code(PURGE_ROUTE)
    expect(route).toContain('UUID_RE.test(id)')
    expect(route, '把两种 id 匹配塞进了同一个 or() —— id 非 uuid 时 PG 报 22P02').not.toContain('or(')
  })

  it('N6 列表接口返回 ready（= 有对应 PRF wrapper）', () => {
    const list = code(LIST_ROUTE)
    expect(list, '没有查 PRF wrapper').toContain("where(eq(keyWrappers.wrapperType, 'passkey_prf'))")
    expect(list, '没有把 ready 下发').toContain('ready: readyIds.has(c.credentialId)')
  })
})

// ============================================================================
// 三、半截钥匙（注册最后一步没跑完）
// ============================================================================
describe('未完成设置的通行密钥', () => {
  it('N7 客户端有独立的错误码与文案，不再与「浏览器不支持 PRF」混用', () => {
    const s = code(SESSION)
    expect(s, '没有导出新错误码').toContain("export const INCOMPLETE_CREDENTIAL = 'incomplete_credential'")
    expect(s, '错误码没有中文文案（登录页会原样透传英文码）').toContain('[INCOMPLETE_CREDENTIAL]:')
    // ★ 用户报的「验证之后没反应」的真凶：原来这里返回 PRF_UNAVAILABLE，
    //   而登录页/解锁入口对 PRF_UNAVAILABLE 的处理是**静默**切到恢复密钥模式。
    const wrapperGate = pos(s, 'if (prfWrapper) {')
    const incomplete = pos(s, 'return { ok: false, error: INCOMPLETE_CREDENTIAL, via: null }')
    const prfDown = pos(s, 'return { ok: false, error: PRF_UNAVAILABLE, via: null }')
    expect(incomplete, 'INCOMPLETE_CREDENTIAL 必须在 wrapper 命中判断之后（前面命中就返回了）').toBeGreaterThan(wrapperGate)
    expect(prfDown, 'PRF_UNAVAILABLE 的降级返回必须仍在（浏览器不支持 PRF 是正常路径）').toBeGreaterThan(incomplete)
  })

  it('N8 客户端按归一化后的 credentialId 找 wrapper', () => {
    const s = code(SESSION)
    // 同一把凭据在不同浏览器/系统版本上返回的 base64url 可能在填充/大小写上不同
    expect(s, '比较前没有归一化 —— 会误判成「这把钥匙没有 wrapper」').toContain(
      'normalizeCredentialId(w.credentialId) === normalizeCredentialId(assertionId)',
    )
  })

  it('N9 登录页给出明确原因（并把人送到恢复密钥），不再是静默切换', () => {
    const page = code(LOGIN_PAGE)
    const branch = between(
      page,
      'if (result.error === INCOMPLETE_CREDENTIAL) {',
      'if (result.error === LOGIN_ERRORS.unknown_credential)',
    )
    expect(branch, '没有切到恢复密钥模式（那是此刻唯一的出路）').toContain("setMode('recovery')")
    expect(branch, '没有把原因显示出来').toContain('setError(LOGIN_ERRORS[INCOMPLETE_CREDENTIAL])')
    // 从解锁入口跳过来时带 ?reason=incomplete：直接以恢复密钥模式开场 + 显示原因
    expect(page, 'mode 没有按 reason 惰性初始化').toContain(
      "useState<'passkey' | 'recovery'>(reason === 'incomplete' ? 'recovery' : 'passkey')",
    )
    expect(page, '没有渲染 reason=incomplete 的说明').toContain('请用恢复密钥登录，登录后在「设置 → 通行密钥」中删除它')
  })

  it('N10 解锁入口（UnlockPrompt）也把它与 PRF 不可用分开：跳登录页并带上原因', () => {
    const hook = code(UNLOCK_HOOK)
    expect(hook, '解锁入口没有处理这种钥匙').toContain("router.replace('/login?reason=incomplete')")
    // 顺序：PRF 不可用（正常降级）在前，未完成钥匙在后
    expect(pos(hook, "router.replace('/login')")).toBeLessThan(pos(hook, "router.replace('/login?reason=incomplete')"))
    expect(hook, '未完成钥匙不该走「自动重试一次」（那把钥匙试几次都解不开）').not.toContain(
      'INCOMPLETE_CREDENTIAL) { retriedRef.current',
    )
  })

  it('N11 列表里标成「未完成」并只能删除（不给启用/禁用按钮）', () => {
    const src = code(DIALOG)
    expect(src, '没有「未完成」徽标').toContain('>未完成</span>')
    const branch = between(src, '{!pk.ready ? (', ') : pk.disabled ? (')
    expect(branch, '未完成的行没有删除入口').toContain('setRemoving(pk)')
    expect(branch, '未完成的行不该出现启用/禁用按钮').not.toContain('setConfirming')
    expect(src, '底部说明没有覆盖「未完成」的情况').toContain('请删除后重新添加')
  })

  it('N12 添加流程自己负责清理（要么跑完、要么清掉），404 也算清理成功', () => {
    const panel = code(ADD_PANEL)
    expect(panel).toContain('purgeRegistered')
    const catchBlock = between(panel, '} catch (e) {', '} finally {')
    expect(catchBlock, '失败时没有清理刚注册的凭据 ⇒ 留下「认证能过但解不开」的坏钥匙').toContain(
      'purgeRegistered(registeredId)',
    )
    expect(pos(panel, "if (!regResp.ok) throw new Error('注册失败')"), 'registeredId 必须在注册成功之后才赋值').toBeLessThan(
      pos(panel, 'registeredId = (registration as'),
    )
    expect(panel, 'purge 返回 404 也该算清理成功（注册请求可能根本没落库）').toContain('res.status === 404')
  })
})

// ============================================================================
// 四、「启用 ▾」下拉（用户要求：禁用之后不该只能启用，还要能删）
// ============================================================================
describe('已禁用钥匙的两个按钮与信息行', () => {
  it('N13 已禁用行直接并排「启用」「删除」两个按钮（不再有折叠展开）', () => {
    const src = code(DIALOG)
    // 用户要求（2026-10-10）：禁用后按钮那里就变成 2 个按钮，不要折叠展开
    for (const gone of ['aria-haspopup', 'setMenuFor', 'role="menuitem"']) {
      expect(src, `折叠展开那一级又回来了（源码里出现「${gone}」）`).not.toContain(gone)
    }
    const branch = between(src, ') : pk.disabled ? (', ') : (')
    expect(branch, '已禁用行不是并排两个按钮').toContain('flex shrink-0 gap-1.5')
    expect(branch, '少了「启用」').toContain('void enable(pk)')
    expect(branch, '少了「删除」').toContain('setRemoving(pk)')
    // 删除必须是硬删除（purge），不能复用软禁用的 DELETE
    expect(src, '删除没有走 purge 接口').toContain('fetch(`/api/keys/passkeys/${pk.id}/purge`')
  })

  it('N14 信息行独占一整行：去掉凭证尾号、「添加于」是天数、「最近使用」带冒号', () => {
    const src = code(DIALOG)
    // 用户反馈「最近使用被截断」：它原先与凭证尾号挤在按钮左侧，两个按钮一进来就只剩 ~160px。
    expect(src, '凭证尾号又出现在列表里了（它会把「最近使用」挤掉）').not.toContain('{pk.credentialIdMasked}')
    const infoAt = pos(src, '添加于 {daysAgo(pk.createdAt)}')
    expect(infoAt, '信息行必须排在按钮行之后（独占整行，才不会被挤断）').toBeGreaterThan(
      pos(src, '<div className="flex items-center justify-between gap-3">'),
    )
    expect(src, '没有「x 天前」的换算').toContain("return days <= 0 ? '今天' : `${days} 天前`")
    expect(src, '「最近使用」丢了冒号或完整日期时间').toContain('最近使用：${fmtDateTime(pk.lastUsedAt)}')
    // 反面：旧的那两个短格式函数不该再被用到
    expect(src).not.toContain('fmtShortTime')
  })

  it('N15 删除是破坏性操作：必须二次确认，且最后一个可用钥匙要给出强提示', () => {
    const src = code(DIALOG)
    // 不止右界 → 这段是文件最后一块，切到文件尾即可（写死右界会被换行符/缩进变化搞空转）
    const confirmBlock = src.slice(pos(src, '{removing && ('))
    expect(confirmBlock, '删除没有二次确认弹窗').toContain('<ConfirmDialog')
    expect(confirmBlock, '确认弹窗不是破坏性样式').toContain('destructive')
    expect(confirmBlock, '确认后没有调用 purge').toContain('void purge()')
    expect(confirmBlock, '删掉最后一个可用钥匙时必须说明后果').toContain('这是最后一个能解锁日记的通行密钥')
    expect(src, '没有计算「还能真正解锁日记的钥匙数」（未完成/已禁用的都不该算）').toContain(
      'passkeys.filter((p) => p.ready && !p.disabled)',
    )
  })
})
