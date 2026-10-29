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

// ============================================================================
// 2026-10-29 第二轮调整（用户六条要求）
// ============================================================================
describe('BE · 归档交互与统计口径', () => {
  it('BE1 详情页归档先确认，成功后给 toast', () => {
    const src = code('components/EntryView.tsx')
    // 点图标不能直接发请求：先弹确认。2026-10-29 起这个"小提示"是**气泡**（Popconfirm），
    // 不再是整块模态 —— 所以断言必须指向 Popconfirm；写成 `<ConfirmDialog` 会被同一个文件里
    // 「确定不保存所做修改吗」那个模态喂成假通过（它一直在那儿）。
    expect(src, '详情页的归档按钮没有先弹确认').toContain('onClick={() => setConfirmArchive(true)}')
    expect(src, '归档没有接气泡确认').toMatch(/<Popconfirm[\s\S]{0,300}?open=\{confirmArchive\}/)
    // 确认后走原来的 toggleArchive
    expect(src, '确认后没有执行归档').toContain('void toggleArchive()')
    // 成功后必须有明显提示（否则只能靠信息行末尾那两个字判断成没成）
    expect(src, '归档成功后没有 toast').toContain('setArchiveFlash(')
    expect(src, '没有把 toast 渲染出来').toMatch(/\{archiveFlash && <Toast/)
  })

  it('BE2 归档页的「彻底删除」走两段确认', () => {
    const src = code(ARCHIVE_VIEW)
    expect(src, '删除没有走分步确认').toContain('deleteStep')
    // 两段：第一问 setDeleteStep(2)，第二问才真删
    expect(src, '第一问之后没有进第二问').toContain('onConfirm={() => setDeleteStep(2)}')
    expect(src, '第二问没有执行删除').toContain('void submitBulkDelete()')
    // 第二问的拒绝词要弱化（「我再想想」比「取消」更让人停下来）
    expect(src, '第二问的取消文案太顺手了').toContain('我再想想')
    // 操作条上的文案是「彻底删除」，与列表页的「删除」区分开
    expect(src, '操作条没有「彻底删除」').toContain('dangerLabel="彻底删除"')
  })

  it('BE3 两个列表页的操作条都有全选', () => {
    for (const rel of [LIST, ARCHIVE_VIEW]) {
      const src = code(rel)
      expect(src, `${rel} 没有全选逻辑`).toContain('function toggleSelectAll')
      expect(src, `${rel} 没有把 total 传给操作条`).toContain('total={items.length}')
      expect(src, `${rel} 没有接上全选回调`).toContain('onToggleAll={toggleSelectAll}')
    }
    expect(code(BAR), '操作条里没有全选按钮').toContain("allSelected ? '取消全选' : '全选'")
  })

  it('BE4 「归档计入统计」偏好：三处登记 + 默认关 + 接口按参数走', () => {
    const prefs = code('lib/client/prefs.ts')
    expect(prefs, '没有这个键').toContain("COUNT_ARCHIVED_KEY = 'qo-count-archived'")
    // ★ 默认关 ⇒ 必须是 === '1'；写成 !== '0' 会让所有人一打开偏好就看到"开"
    expect(prefs, '默认值读反了（应该 === 1 才是开）').toMatch(/isCountArchivedEnabled\(\)[\s\S]{0,160}=== '1'/)
    expect(prefs, '没进 ALL_KEYS（登录后拉不回来）').toMatch(/ALL_KEYS = \[[^\]]*COUNT_ARCHIVED_KEY/)
    expect(code('app/api/prefs/route.ts'), '没进 PREF_KEYS（PUT 会 400）').toContain("'qo-count-archived'")
    expect(code('components/PrefsDialog.tsx'), '偏好弹窗里没有这一行').toContain('COUNT_ARCHIVED_KEY')
    // 服务端按查询参数走，不猜偏好。
    // ★ 必须断到 `searchParams.get(...) === '1'` —— 只断言"出现过 includeArchived"
    //   在把它改成 `= false` 时照样通过（非空转验证抓到的）。
    for (const api of ['app/api/diary/stats/route.ts', 'app/api/diary/on-this-day/route.ts']) {
      expect(code(api), `${api} 没有真的从查询参数取 includeArchived`)
        .toMatch(/searchParams\.get\('includeArchived'\) === '1'/)
      // 而且必须真的进了 SQL（否则参数取了也没用）
      expect(code(api), `${api} 取到参数但没用进 SQL`).toContain('::boolean OR archived_at IS NULL')
    }
    // 客户端五个调用点都要带上（漏一处 = 那个页面的统计口径与开关不一致）
    expect(code(LIST), '列表页的 stats 没带参数').toContain('statsScopeQuery()')
    expect(code('components/DiaryEditor.tsx'), '写页的 stats 没带参数').toContain('statsScopeQuery()')
    expect(code('lib/client/diary-overview.ts'), '概览的 stats 没带参数').toContain('statsScopeQuery()')
  })
})

// ============================================================================
// 2026-10-29 第三轮反馈（四条）
//
// 其中 BG1 是**同一个问题被报两次**：多选按钮"还在右边"。
// 根因不在按钮本身，而在页头的 `justify-end` —— 标题是 absolute 定位、不参与 flex 排布，
// 所以流内只剩「按钮 + 搜索」两个子元素，`justify-end` 会把它们一起推到右边。
// 这条断言直接钉 header 的排布，而不是钉按钮的类名（钉按钮是钉不住的：按钮类名完全正确）。
// ============================================================================
describe('BG · 第三轮反馈', () => {
  it('BG1 列表页页头用 justify-between（多选按钮必须在最左）', () => {
    const src = code(LIST)
    expect(src, '页头不是 justify-between —— 多选按钮会被推到右边')
      .toContain('page-header relative flex shrink-0 items-center justify-between')
    // 反向：整页不许再出现 justify-end（标题是 absolute，任何 justify-end 都只影响左右两个按钮）
    expect(src, '又出现了 justify-end（标题绝对居中不需要它）').not.toContain('items-center justify-end')
  })

  it('BG2 隐藏面板打开时关于弹窗整块不渲染', () => {
    const about = code('components/AboutDialog.tsx')
    const hideAt = at(about, '{!hiddenOpen && (')
    const panelAt = at(about, '{hiddenOpen && (')
    expect(hideAt, '关于卡片没有被条件隐藏 —— 面板打开时白卡会透在遮罩下面').toBeLessThan(panelAt)
    // 面板自带遮罩、单独成层：不能再套进 about 的遮罩里（两层 40% 会叠成 64%）
    expect(about, '隐藏面板没有用 shared 常量/独立成层').toContain('<HiddenPanel')
  })

  it('BG3 归档页长按也能进选择态（不能只加在列表页）', () => {
    const src = code(ARCHIVE_VIEW)
    // 上一版只有列表页有长按，归档页整行是裸 <Link> ⇒ 长按只会导航
    expect(src, '归档页没有长按计时器').toContain('longPressTimerRef')
    expect(src, '归档页没有 startLongPress').toContain('function startLongPress')
    expect(src, '归档页的行没有挂长按').toContain('onPointerDown={() => startLongPress(item.id)}')
    // 挡 iOS 链接预览：只有 -webkit-touch-callout 管用（user-select 管不了）
    expect(src, '归档页的行没挂 qo-hold-select').toContain('qo-hold-select')
    // 长按进选择态后必须压掉那一次 click
    expect(src, '长按后没有把 suppressNavRef 置 true').toContain('suppressNavRef.current = true')
    expect(src, '那一次 click 没有检查标记').toMatch(/if \(suppressNavRef\.current\) \{\s*\n\s*e\.preventDefault\(\)/)
  })

  it('BG4 归档页顶部的总篇数来自服务端 total（不是已加载条数）', () => {
    const api = code('app/api/diary/route.ts')
    expect(api, '列表接口没有返回 total').toContain('total: totalRows[0]?.n ?? 0')
    // ★ 口径：archived 过滤之内、**不含游标**（游标是"还剩多少没翻"，不是"一共多少"）
    expect(api, 'total 的 where 用了含游标的 where（数字会随翻页变小）')
      .toMatch(/count\(\*\)::int[\s\S]{0,120}?\.where\(archivedWhere\)/)
    const view = code(ARCHIVE_VIEW)
    expect(view, '归档页没有接收 total').toContain('setTotal(first.total)')
    expect(view, '归档页没有显示总篇数').toContain('共 ${total + pendingCount} 篇')
    // 离线时不能编数字
    expect(view, '离线时也硬算总数了').toContain('已加载 ${items.length} 篇')
  })

  it('BG5 「归档计入统计」的说明文案压到一行（≤16 字，且是用户指定的措辞）', () => {
    const src = code('components/PrefsDialog.tsx')
    const m = src.match(/COUNT_ARCHIVED_KEY,[^\n]*hint: '([^']*)'/)
    expect(m, '找不到这条偏好的 hint').not.toBeNull()
    expect(m![1], '文案被改掉了（2026-10-29 用户指定这一句）').toBe('计入热力图、天数、篇数与字数统计')
    // 同一张列表里其它 hint 都在 16 字以内；超过就会折行，整行比邻居高一截
    expect(m![1].length, `说明文字 ${m![1].length} 字，会折行`).toBeLessThanOrEqual(16)
  })
})

// ============================================================================
// 2026-10-29 第五轮（三条）
// ============================================================================
describe('BH · 第五轮反馈', () => {
  it('BH1 多选态右侧是「退出多选」，不再写「完成」', () => {
    for (const rel of [LIST, ARCHIVE_VIEW]) {
      const src = code(rel)
      expect(src, `${rel} 的多选态没有「退出多选」`).toContain('>退出多选</button>')
      // 反向：多选没有"完成"这个动作，写成完成会让人以为还要去哪一步。
      // ⚠️ 只对**这个按钮**断言（整页里别处还有「完成」——弹窗底栏就是两个字）
      expect(src, `${rel} 又多出一个「完成」按钮`).not.toContain('>完成</button>\n')
    }
  })

  it('BH2 删除流程打开时不渲染隐藏入口面板（两个 fixed 层不许叠）', () => {
    const src = code('components/HiddenPanel.tsx')
    const hideAt = src.indexOf('{!wipeOpen && (')
    const flowAt = src.indexOf('{wipeOpen && (')
    expect(hideAt, '删除流程打开时面板没有被隐藏 —— 两个 fixed inset-0 会重叠').toBeGreaterThanOrEqual(0)
    expect(hideAt, '隐藏逻辑写反了（应该先隐藏面板、再渲染流程）').toBeLessThan(flowAt)
  })
})
