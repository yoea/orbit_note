// 守卫：批量归档 / 取消归档（阶段 4，2026-10-29）
//
// 这个功能有三条"看起来能跑、实际上会静默出错"的路径，全部钉在这里：
//   1. **服务端顺手写了 updatedAt** ⇒ 详情页凭空多一行「上次编辑」（归档不是编辑）；
//   2. **不跳过已处于目标状态的行** ⇒ 批量归档会把早已归档那几篇的归档时间刷成今天，
//      归档页的「归档于 3 天前」集体变成「今天」；
//   3. **成功只改内存 items、不改本地缓存** ⇒ 断网后那些条目又回到「未归档」列表
//      （列表页离线读缓存）。这与「收藏成功必须回写缓存」「归档页不许 prune」是同一族的一致性要求。
//
// 另外 BA7 钉的是布局：操作条不能是 fixed（TabBar 在文档流内，fixed 会把它盖住，
// 而 TabBar 是离开列表页的唯一出口）。
//
// 非空转验证：Temp/nonvacuous_bulk_archive.py
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot } from './class-attrs'

const API = 'app/api/diary/archive/route.ts'
const CLIENT = 'lib/client/bulk-ops.ts'
const PATCH_API = 'app/api/diary/[id]/route.ts'
const DELETE_API = 'app/api/diary/delete/route.ts'
const VALIDATION = 'lib/server/validation.ts'
const OFFLINE = 'lib/client/offline.ts'
const LIST = 'components/DiaryListView.tsx'
const ARCHIVE_VIEW = 'components/ArchiveListView.tsx'
const BAR = 'components/BulkActionBar.tsx'

function code(rel: string): string {
  return readFileSync(join(projectRoot, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function at(hay: string, needle: string): number {
  const i = hay.indexOf(needle)
  expect(i, `锚点未找到：${needle}`).toBeGreaterThanOrEqual(0)
  return i
}

describe('BA · 批量归档', () => {
  it('BA0 解析自检：六个文件都读到了关键锚（防断言空转）', () => {
    for (const [rel, needle] of [
      [API, 'bulkArchiveSchema'],
      [CLIENT, "postBulk('/api/diary/archive'"],
      [DELETE_API, 'bulkDeleteSchema'],
      [VALIDATION, 'MAX_BULK_ARCHIVE'],
      [OFFLINE, 'patchCachedEntries'],
      [LIST, 'submitBulkArchive'],
      [ARCHIVE_VIEW, 'submitBulkUnarchive'],
    ] as const) {
      const src = code(rel)
      expect(src.length, `${rel} 读不到内容`).toBeGreaterThan(200)
      expect(src, `${rel} 里找不到「${needle}」`).toContain(needle)
    }
  })

  it('BA1 接口有鉴权 + 同源校验 + 静态 key 的限流 + schema 校验', () => {
    const src = code(API)
    expect(src, '缺 requireAuth').toContain('requireAuth(req)')
    expect(src, '缺同源校验（批量写操作尤其需要）').toContain('assertSameOrigin(req)')
    // 限流 key 必须静态（动态 key 会让限流形同虚设）
    expect(src, '限流 key 不是静态字符串').toMatch(/rateLimit\('diary-archive-bulk'/)
    expect(src, '没有校验请求体').toContain('bulkArchiveSchema.safeParse')
    expect(code(VALIDATION), 'schema 里 ids 没有 uuid 校验（非 uuid 会让 PG 报 22P02）').toContain('z.array(z.string().uuid())')
  })

  it('BA2 ★ 服务端绝不写 updatedAt（归档不是编辑）', () => {
    const src = code(API)
    // 只允许 set 这一列
    expect(src, 'UPDATE 没有只 set archivedAt').toContain('.set({ archivedAt:')
    expect(src, '服务端写了 updatedAt —— 详情页会凭空多一行「上次编辑」').not.toContain('updatedAt')
  })

  it('BA3 ★ 已经处于目标状态的行跳过（否则归档时间会被刷成今天）', () => {
    const src = code(API)
    expect(src, '批量归档没有排除「已经是归档状态」的行').toContain('isNull(diaryEntries.archivedAt)')
    expect(src, '批量取消归档没有排除「本来就没归档」的行').toContain('isNotNull(diaryEntries.archivedAt)')
  })

  it('BA4 服务器上已不存在的 id 要如实返回（别让用户对着「选了 10 篇成功了 8 篇」发懵）', () => {
    const src = code(API)
    expect(src, '没有算 missing').toContain('const missing =')
    expect(src, '返回体里没有 missing').toContain('updated, missing')
  })

  it('BA5 客户端走专用接口，不是循环 PATCH（循环会撞限流）', () => {
    expect(code(CLIENT), '客户端没打到 /api/diary/archive').toContain("postBulk('/api/diary/archive'")
    const list = code(LIST)
    expect(list, '列表页没有调用 postBulkArchive').toContain('postBulkArchive(ids, true)')
    // 反向：列表页不许出现「逐条 PATCH」的写法
    expect(list, '列表页在循环 PATCH 单条接口 —— 会撞单实例内存限流').not.toMatch(/for \([\s\S]{0,120}\/api\/diary\/\$\{/)
  })

  it('BA6 ★ 批量成功后必须改写本地缓存（否则断网后条目又回到列表）', () => {
    const src = code(LIST)
    expect(src, '列表页没调 patchCachedEntries').toContain('patchCachedEntries(')
    // 归档 ⇒ 写时间戳；取消归档 ⇒ 写 null。两者都要有，只写一边会让另一半在离线时错位
    expect(src, '归档后没有把 archivedAt 写进缓存').toMatch(/patchCachedEntries\([\s\S]{0,80}archivedAt: new Date/)
    expect(code(ARCHIVE_VIEW), '取消归档后没有把 archivedAt 清成 null').toMatch(/patchCachedEntries\([\s\S]{0,80}archivedAt: null/)
    // 实现必须在串行锁里做（读-改-写，并发会互相覆盖）
    const off = code(OFFLINE)
    const fnAt = at(off, 'export async function patchCachedEntries')
    const slice = off.slice(fnAt, off.indexOf('\n}', fnAt))
    expect(slice.length, 'patchCachedEntries 切片过短，断言会空转').toBeGreaterThan(120)
    expect(slice, 'patchCachedEntries 没进 withEntriesLock —— 与其它三个写缓存函数并发会互相覆盖').toContain('withEntriesLock')
  })

  it('BA7 操作条在流内、不是 fixed（fixed 会盖住 TabBar）', () => {
    const bar = code(BAR)
    expect(bar, 'BulkActionBar 用了 fixed —— 会盖住 TabBar').not.toContain('fixed')
    expect(bar, '操作条不是 shrink-0（放进 flex 列里会被压扁）').toContain('shrink-0')
    // 两个页面都要把它放在滚动容器之后
    for (const rel of [LIST, ARCHIVE_VIEW]) {
      const src = code(rel)
      const barAt = at(src, '<BulkActionBar')
      expect(src.slice(barAt), `${rel} 里操作条后面没有 </main>`).toContain('</main>')
    }
  })

  it('BA8 列表页有「可靠入口」（选择按钮），长按只是加速', () => {
    const src = code(LIST)
    // 按钮文字是「选择」，锚点要落在 onClick 上（注释已被剥掉，断言文案会空转）
    expect(src, '列表页没有显式的选择入口 —— 只靠长按等于没有入口').toContain('selectMode ? exitSelect() : enterSelect()')
    expect(src, '缺少长按处理').toContain('startLongPress')
    // 长按触发后必须把标记**置为 true**，否则那一次 click 会把人带去详情页。
    // ★ 只断言「出现过 suppressNavRef」是不够的：把它改成 = false 仍然含这个标识符，
    //   这种破坏在非空转验证里被当场抓出来（第一次就是这么漏的）。
    expect(src, '长按后没有把 suppressNavRef 置为 true（会一边进选择态一边跳详情页）')
      .toContain('suppressNavRef.current = true')
    expect(src, '那一次 click 没有检查标记').toMatch(/if \(suppressNavRef\.current\) \{[\s\S]{0,80}preventDefault\(\)/)
  })

  it('BA9 批量才弹确认（单条归档不弹）', () => {
    for (const rel of [LIST, ARCHIVE_VIEW]) {
      // ★ 正则而不是 toContain('<ConfirmDialog')：后者在把标签改成 <ConfirmDialogX 时
      //   依然为真（前缀匹配），破坏会漏网（非空转验证抓到的）
      expect(code(rel), `${rel} 的批量操作没有确认弹窗`).toMatch(/<ConfirmDialog[\s>]/)
    }
  })
})

// ============================================================================
// 2026-10-29 真实 bug：详情页点归档图标 → 「归档失败，请重试」
//
// 根因不在 UI：PATCH 路由把校验后的**字符串**直接塞进 drizzle 的 .set()，
// 而 timestamp 列（mode: 'date'）在构造 SQL 时会调 value.toISOString()
// ⇒ TypeError ⇒ 500 ⇒ 客户端只看到「归档失败」。
// 服务端日志里才是真话（`TypeError: e.toISOString is not a function`）。
// 批量接口当时写了 new Date() 所以没事，只有这条单条路径漏了 —— 这种"一半对一半错"
// 最容易漏，所以单独钉一条。
// ============================================================================
describe('BA10 · 单条 PATCH 的 archivedAt 类型', () => {
  it('★ 落库前必须转成 Date（字符串会让 drizzle 抛 toISOString）', () => {
    const src = code(PATCH_API)
    expect(src, 'PATCH 里没有把 archivedAt 转成 Date —— 归档会 500').toMatch(
      /set\.archivedAt = patch\.archivedAt === null \? null : new Date\(patch\.archivedAt\)/,
    )
  })

  it('其余写入点也都转过（POST / 导入 / 批量接口）', () => {
    expect(code('app/api/diary/route.ts'), 'POST 没转').toContain('new Date(archivedAt)')
    expect(code('app/api/diary/import/route.ts'), '导入没转').toContain('new Date(d.archivedAt)')
    expect(code(API), '批量接口没转').toContain('archived ? new Date() : null')
  })
})

// ============================================================================
// 批量删除（2026-10-29）
//
// 与归档的区别是**不可逆**，所以三条：限流更严、确认弹窗要 destructive、
// 删除后本地缓存与离线队列都得清（否则断网后它们还在列表里）。
// ============================================================================
describe('BD · 批量删除', () => {
  it('BD1 独立接口（不与归档合成） + 比归档更严的限流', () => {
    const src = code(DELETE_API)
    expect(src, '删除接口缺鉴权').toContain('requireAuth(req)')
    expect(src, '删除接口缺同源校验').toContain('assertSameOrigin(req)')
    // 归档 20 次/分钟；删除不可逆，10 次
    expect(src, '删除的限流不比归档严').toMatch(/rateLimit\('diary-delete-bulk', 10, 60_000\)/)
    expect(src, '删除没有校验请求体').toContain('bulkDeleteSchema.safeParse')
    // 反向：删除不该塞进 archive 接口里靠一个 action 参数分叉
    expect(code(API), '归档接口里出现了删除逻辑 —— 两件事的危险等级不同，不该共用一个接口').not.toContain('delete(')
  })

  it('BD2 客户端走专用接口，且错误文案带动作名', () => {
    const src = code(CLIENT)
    expect(src, '客户端没打到 /api/diary/delete').toContain("postBulk('/api/diary/delete'")
    // 「归档失败」和「删除失败」对用户意义不同，文案必须带动作名
    expect(src, '错误文案没有按动作名区分').toContain('${verb}失败，请重试')
    expect(code(LIST), '列表页没有调用 postBulkDelete').toContain('postBulkDelete(ids)')
  })

  it('BD3 ★ 删除后缓存与离线队列都要清', () => {
    const list = code(LIST)
    expect(list, '删除后没清本地缓存 —— 断网后条目还在列表里').toContain('removeCachedEntries(ids)')
    expect(list, '删除后没清离线队列 —— 离线新建的条目会带着「未同步」留在列表').toContain('removeQueuedEntry(id)')
    // 批量版必须在锁里（与单个版本同一条约束）
    const off = code(OFFLINE)
    const at0 = at(off, 'export async function removeCachedEntries')
    const slice = off.slice(at0, off.indexOf('\n}', at0))
    expect(slice.length, 'removeCachedEntries 切片过短，断言会空转').toBeGreaterThan(120)
    expect(slice, 'removeCachedEntries 没进 withEntriesLock').toContain('withEntriesLock')
  })

  it('BD4 确认弹窗是破坏性样式，且写清「无法恢复」', () => {
    const list = code(LIST)
    expect(list, '删除确认没标 destructive（按钮不是红的）').toContain('destructive')
    expect(list, '删除确认没写「无法恢复」—— 用户会以为是归档').toContain('无法恢复')
    expect(list, '删除确认没告诉用户「也可以用归档」').toContain('用「归档」')
    expect(list, '确认按钮文案不是「永久删除」').toContain('永久删除')
  })

  it('BD5 操作条里有删除按钮，且与归档是两个独立动作', () => {
    expect(code(LIST), '操作条没传 dangerLabel').toContain('dangerLabel="删除"')
    expect(code(LIST), '没有 onDanger 处理').toContain('onDanger={() => setConfirmDelete(true)}')
    // 归档与删除必须是两个 submit，合成一个会互相误伤
    expect(code(LIST), '批量删除没有独立函数').toContain('async function submitBulkDelete')
  })
})
