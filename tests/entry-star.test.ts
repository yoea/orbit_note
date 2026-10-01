// 守卫：收藏（星标）的**展示范围**与「收藏不算编辑」两条约定。
//
// 用户对这块的要求非常具体，而且后半句最容易在迭代中被破坏：
//   「可以在笔记最底部点击收藏，需要入数据库，收藏状态**仅在查看页面和笔记列表页面**
//     以**暖色 Q 版五角星**图标展示，**不影响其他页面**。」
//
// 于是这里钉四件事：
//   A. 星图标只出现在「查看页」与「笔记列表页」——别的页面出现即回归（S1/S5/S6）；
//   B. 图标是**暖色**、且是「Q 版」造型（圆角描边 + 胖星），不是评分控件那种冷色尖星（S2/S3）；
//   C. 「收藏」是**元数据更新**，PATCH 绝不能带 ciphertext/iv（S7）——否则服务端会更新
//      updatedAt，详情页凭空多出一行「编辑于」；这条与定位改动是同一约定。
//   D. 离线也能收藏：未同步笔记写本地队列时必须把 starred 一起带上（S7 末段）。
//
// 判定一律先断言下标 >= 0 再比大小：`indexOf` 未命中返回 -1，而 `-1 < 正数` 恒真，
// 不做这一步的话「目标被删掉」时断言反而会通过（见 tests/entry-tail-row.test.ts 的同款教训）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { collectSourceFiles, projectRoot, stripComments } from './class-attrs'

const rel = (p: string) => relative(projectRoot, p).split(sep).join('/')
const read = (f: string) => stripComments(readFileSync(join(projectRoot, f), 'utf8'))

/** 所有组件与页面源码（转成 POSIX 相对路径，便于按文件名断言） */
const UI_FILES = ['components', 'app'].flatMap((d) => collectSourceFiles(join(projectRoot, d)).map(rel)).sort()

const DEF_FILE = 'components/StarIcon.tsx'
const VIEW_FILE = 'components/EntryView.tsx'
const LIST_FILE = 'components/DiaryListView.tsx'

function indexOrFail(src: string, needle: string, where: string): number {
  const i = src.indexOf(needle)
  expect(i, `${where} 里找不到「${needle}」，后面的比较会空转`).toBeGreaterThanOrEqual(0)
  return i
}

/** 从 start 处切到 end 处（end 必须存在，否则报错——防切片成空串导致断言空转） */
function sliceOrFail(src: string, start: string, end: string, where: string): string {
  const a = indexOrFail(src, start, where)
  const b = src.indexOf(end, a)
  expect(b, `${where} 里「${start}」之后找不到「${end}」，切出来会是空串`).toBeGreaterThan(a)
  return src.slice(a, b)
}

describe('S · 收藏（星标）', () => {
  const def = read(DEF_FILE)
  const view = read(VIEW_FILE)
  const list = read(LIST_FILE)

  it('S0 前置：锚点与扫描结果齐全（防后续断言空转）', () => {
    expect(UI_FILES.length, '没扫到任何 UI 源码文件').toBeGreaterThan(10)
    for (const f of [DEF_FILE, VIEW_FILE, LIST_FILE]) expect(UI_FILES).toContain(f)
    for (const needle of ['StarIcon', 'toggleStar', 'item.starred', 'linearGradient']) {
      expect(def + view + list, `三份源码里都找不到锚点「${needle}」`).toContain(needle)
    }
  })

  it('S1 星图标只出现在查看页与笔记列表页（用户明确要求「不影响其他页面」）', () => {
    const users = UI_FILES.filter((f) => f !== DEF_FILE && read(f).includes('StarIcon'))
    expect(
      users,
      '星图标扩散到别的页面了 —— 收藏是「这一篇的状态」，在多处出现会让人以为它们各自独立',
    ).toEqual([LIST_FILE, VIEW_FILE])
  })

  it('S2 图标是**暖色**：amber→orange 渐变，且不蹭 TabBar 那套冷色描边渐变', () => {
    expect(def, '没有渐变——实心星就成了一条色块').toContain('linearGradient')
    for (const warm of ['#fbbf24', '#f59e0b', '#f97316']) {
      expect(def, `缺少暖色 stop ${warm}`).toContain(warm)
    }
    expect(def, '引了 TabBar 的 qo-tab-accent（冷色描边渐变）——收藏要的是暖色实心').not.toContain('qo-tab-accent')
    // 暖色系一律是橙黄方向：R 通道必须明显高于 B 通道（防有人换成 violet/blue 还叫「暖色」）
    for (const hex of def.match(/#[0-9a-f]{6}/gi) ?? []) {
      const r = parseInt(hex.slice(1, 3), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      expect(r, `${hex} 不是暖色（R ≤ B）`).toBeGreaterThan(b)
    }
  })

  it('S3 造型是 Q 版：圆角描边 + 「已收藏」描边比「未收藏」更粗', () => {
    expect(def).toContain('strokeLinejoin="round"')
    expect(def).toContain('strokeLinecap="round"')
    // 实心态用**同色粗描边**把五个尖角磨圆（只靠 fill 的话尖角很锐，像评分控件）
    const m = /strokeWidth=\{filled \? ([\d.]+) : ([\d.]+)\}/.exec(def)
    expect(m, '找不到 filled / 未 filled 两档描边宽度').not.toBeNull()
    expect(Number(m![1]), '实心态的描边不够粗，尖角磨不圆').toBeGreaterThan(Number(m![2]))
    // 实心走渐变、未收藏走描边
    expect(def).toContain('url(#')
    expect(def, '未收藏态必须是空心描边星（否则两颗星看起来一样）').toContain("'none'")
  })

  it('S4 渐变 id 每实例唯一（同页多颗星不能共用一个 id）', () => {
    expect(def, '没用 useId —— 多颗星会撞 id，第一颗卸载后其余星填充失效').toContain('useId()')
    expect(def, 'useId 带冒号，SVG 的 url(#…) 里必须剥掉').toMatch(/replace\(\/:\/g, ''\)/)
    expect(def).toContain('id={gradientId}')
  })

  it('S5 列表页：只在已收藏时渲染，带可访问标签，且**不可点**（整行已经是链接）', () => {
    const block = sliceOrFail(list, 'item.starred && (', 'item.pending && (', LIST_FILE)
    expect(block, '星标块里没有渲染星图标').toContain('<StarIcon')
    expect(block, '缺少可访问标签（纯装饰图标对屏幕阅读器等于噪声）').toContain('role="img"')
    expect(block).toContain('aria-label="已收藏"')
    expect(block, '列表里的星不该能点 —— 整行已经是 <Link>，嵌套交互元素会互相打断').not.toContain('onClick')
    // 列表页的星恒为实心：条件已保证「只有收藏的才渲染」，再按状态取色就没有意义
    expect(block).toContain('<StarIcon filled')
  })

  it('S6 查看页：收藏按钮在操作栏（最底部）且只有星形两态 —— 不再有文字标签', () => {
    const btn = sliceOrFail(view, '() => void toggleStar()', '</button>', VIEW_FILE)
    expect(btn, '收藏按钮不是星图标').toContain('<StarIcon')
    expect(btn, '星要反映当前状态（实心=已收藏/描边=未收藏）').toContain('filled={entry.starred}')
    expect(btn, '缺少 aria-pressed —— 屏幕阅读器读不出这是可切换状态').toContain('aria-pressed={entry.starred}')
    // ★ 2026-09-30 用户要求「移除收藏文字，仅通过图标状态变化表示收藏状态」。
    //   文字一去掉，star 就成了**唯一**的视觉信号 ⇒ aria-label / title 从「锦上添花」变成必需：
    //   少了它们，读屏用户听到的只是一个无名按钮，桌面端也没有 hover tooltip 可以救。
    expect(btn, '收藏按钮里又渲染文字了（用户要求只看图标状态）').not.toMatch(/<span[^>]*>[^<]*收藏/)
    expect(btn, '缺少 aria-label —— 图标是唯一信号，读屏用户必须知道这按钮是什么').toContain('aria-label=')
    expect(btn, '缺少 title —— 桌面端没有任何 tooltip 就全靠猜').toContain('title=')
    expect(btn, '没有禁用判据 —— 离线只读时点了会「收藏失败」').toContain('disabled=')
    // 位置：必须在分割线（「编辑于」行与操作栏的分界）**下方**，且在左组里、排在打开次数之后
    const divider = indexOrFail(view, 'border-t', VIEW_FILE)
    const star = indexOrFail(view, '() => void toggleStar()', VIEW_FILE)
    const eye = indexOrFail(view, 'showViews && (', VIEW_FILE)
    expect(star, '收藏按钮跑到「编辑于」那一行里去了（用户要求在最底部）').toBeGreaterThan(divider)
    expect(eye, '打开次数没有排在收藏前面（用户要求「排在最前」）').toBeLessThan(star)
  })

  it('S7 收藏是元数据更新：PATCH 不带 ciphertext/iv，且离线能收藏', () => {
    const fn = sliceOrFail(view, 'async function toggleStar()', 'const remove = useCallback', VIEW_FILE)
    expect(fn).toContain("method: 'PATCH'")
    expect(fn, 'PATCH body 不再是「只带 starred」').toContain('JSON.stringify({ starred: next })')
    expect(
      fn,
      '收藏带了 ciphertext —— 服务端只在带 ciphertext 时更新 updatedAt，详情页会凭空多出「编辑于」',
    ).not.toMatch(/ciphertext/)
    expect(fn, '同上：iv 与 ciphertext 是一对，出现即说明这条路径在写正文').not.toMatch(/\biv\b/)
    // 本地密文缓存要一起回写，否则断网（读缓存）看到的还是改之前的收藏态
    expect(fn, '没有回写本地密文缓存 —— 离线看到的收藏态会是旧的').toContain('cacheEntriesPage')
    // 未同步笔记走本地写队列，且必须把 starred 带上：否则联网补传时服务端用默认 false 抹掉
    expect(fn, '未同步笔记的收藏没写进本地队列').toContain('updateQueuedEntry(id, { starred: next })')
    // 失败必须回滚，不能留个假的已收藏
    expect(fn).toMatch(/catch\s*\{/)
    expect(fn, '失败时没有回滚，界面会留一个服务端并不存在的「已收藏」').toContain('setEntry')
  })

  it('S8 收藏是「收窄」筛选：搜索弹窗只有「只看收藏」一种，没有「只看未收藏」', () => {
    const search = read('components/SearchDialog.tsx')
    expect(search, '筛选里丢了「收藏」这一项').toContain('onlyStarred')
    // 与 range / onlyWithLocation 同一族的单选 chip；出现否定项会让筛选行迅速膨胀
    expect(search, '出现了「未收藏」筛选 —— 收藏是收窄语义，不需要它的补集').not.toContain('未收藏')
  })
})
