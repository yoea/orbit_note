// 守卫：搜索的「范围」三档（阶段 3，2026-10-29）
//
// 这个功能的失效方式很隐蔽：`matches` 的纯逻辑永远是对的（tests/search.test.ts 40 条全绿），
// 坏的只可能是接线 —— 切了范围却没触发加载 ⇒ 新范围是 null ⇒ 一片空白，
// 而代码里没有任何地方会红。这和 2026-09-30「按地点筛选不显示结果」是同一类事故
// （那时是开了面板没 ensureLoaded），所以 QS2/QS8 照那条教训钉。
//
// 另一半是**信息架构**：范围是「换一个数据集」，不是第四个筛选。
// 一旦有人把三档塞进 chip 行，屏幕上就会出现四种"选中态"，而用户定过的
// 「筛选固定三类（时间/地点/收藏）」也就不成立了。QS5 反向钉死。
//
// 非空转验证：Temp/nonvacuous_search_scope.py
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot } from './class-attrs'

const REL = 'components/SearchDialog.tsx'
const ENTRIES = 'lib/client/entries.ts'

/** 剥注释再断言：本文件与源码的注释里都写着这些标识符，不剥会自己撞自己 */
function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const CODE = stripComments(readFileSync(join(projectRoot, REL), 'utf8'))
const ENTRIES_CODE = stripComments(readFileSync(join(projectRoot, ENTRIES), 'utf8'))

function at(hay: string, needle: string): number {
  const i = hay.indexOf(needle)
  expect(i, `锚点未找到：${needle}`).toBeGreaterThanOrEqual(0)
  return i
}

/** 取函数体：从 `function name(` 到下一个两空格缩进的右括号 */
function fnBody(name: string): string {
  const start = at(CODE, `function ${name}(`)
  const end = CODE.indexOf('\n  }', start)
  expect(end, `函数 ${name} 的右括号未找到`).toBeGreaterThan(start)
  return CODE.slice(start, end + 4)
}

describe('QS · 搜索范围（未归档 / 已归档 / 全部）', () => {
  it('QS0 解析自检：常量与三档 id 都在（防断言空转）', () => {
    expect(CODE.length).toBeGreaterThan(3000)
    expect(CODE, '找不到 SEARCH_SCOPES').toContain('SEARCH_SCOPES')
    for (const id of ["'active'", "'archived'", "'all'"]) {
      expect(CODE, `三档里缺 ${id}`).toContain(id)
    }
    expect(CODE, 'fetchAllEntries 已支持 archived 参数这一点变了').toContain('fetchAllEntries({ archived })')
  })

  it('QS1 默认是「未归档」，且三档顺序为 未归档 → 已归档 → 全部', () => {
    // 默认必须是 active：它与列表页/统计/去年今日同一口径。
    // 若默认改成 all，用户会突然搜到早已归档的旧日记，而他在列表里根本看不到它们。
    expect(CODE, '范围默认值不是 active —— 搜索行为会与日常视图脱节').toContain("useState<SearchScope>('active')")
    const active = at(CODE, "{ id: 'active', label: '未归档' }")
    const archived = at(CODE, "{ id: 'archived', label: '已归档' }")
    const all = at(CODE, "{ id: 'all', label: '全部' }")
    expect(active).toBeLessThan(archived)
    expect(archived).toBeLessThan(all)
  })

  it('QS2 ★ 切范围必须触发加载（只 setScope 会让新范围永远空白）', () => {
    const body = fnBody('pickScope')
    expect(body, 'pickScope 没有 setScope').toContain('setScope(next)')
    // 关键：要传 next，不能传当前 scope（state 更新是异步的，此刻它还是旧值）
    expect(body, 'pickScope 里没有用 next 去加载 —— 会拉错数据集').toContain('ensureLoaded(next)')
    expect(body, 'pickScope 没有把已显示条数收回初始值').toContain('setVisibleCount(PAGE)')
  })

  it('QS3 结果存进 target 那个桶（请求在路上时用户可能已经切走）', () => {
    const body = fnBody('ensureLoaded')
    expect(body, '加载函数签名的第一个参数不是 target').toContain('function ensureLoaded(target: SearchScope')
    expect(body, '结果按「当前 scope」存 —— 切走之后会写进错的桶').not.toContain('[scope]:')
    expect(body, '结果没有按 target 存桶').toContain('[target]:')
  })

  it('QS4 三档到接口参数的映射各不相同（UI 的 archived ≠ 接口的 only）', () => {
    const body = fnBody('ensureLoaded')
    expect(body, '缺少 active → exclude 的映射').toMatch(/target === 'active'\s*\?\s*'exclude'/)
    expect(body, '缺少 archived → only 的映射（写成别的就会被服务端当非法值 400）').toMatch(/target === 'archived'\s*\?\s*'only'/)
    expect(body, 'fetchAllEntries 没把 archived 传下去').toContain('fetchAllEntries({ archived })')
    // 接口侧确实接受这三档
    expect(ENTRIES_CODE).toContain("'exclude' | 'only' | 'all'")
  })

  it('QS5 ★ 范围不进 chip 行（筛选恒为三类：时间 → 地点 → 收藏）', () => {
    const scopeRow = at(CODE, 'aria-label="搜索范围"')
    const chipRow = at(CODE, 'flex flex-wrap items-center gap-2 pb-3')
    expect(scopeRow, '范围行跑到 chip 行下面去了').toBeLessThan(chipRow)
    // chip 行内部不得出现范围按钮（否则 UI 上是四个平级筛选项，用户定的「三类」就没了）
    const end = CODE.indexOf('{openPanel ===', chipRow)
    expect(end, '找不到 chip 行之后的第一个面板分支').toBeGreaterThan(chipRow)
    const chipSlice = CODE.slice(chipRow, end)
    expect(chipSlice.length, 'chip 行切片过短，断言会空转').toBeGreaterThan(200)
    expect(chipSlice, '范围按钮被塞进了筛选 chip 行').not.toContain('SEARCH_SCOPES')
    expect(chipSlice, '范围按钮被塞进了筛选 chip 行').not.toContain('pickScope')
  })

  it('QS6 范围不参与「重置」（它换数据集，不是筛选）', () => {
    const body = fnBody('resetFilters')
    expect(body, 'resetFilters 把范围也重置了 —— 用户切到「已归档」再点重置会被弹回未归档').not.toContain('setScope')
  })

  it('QS7 范围非默认也算「有内容要看」（切过去不该只看到输入引导）', () => {
    expect(CODE, 'active 判定没把范围算进去 —— 切到已归档会显示「输入关键词或选择筛选」').toMatch(/const active = !isDefaultFilters\(filters\) \|\| scope !== 'active'/)
  })

  it('QS8 每个范围各自缓存，切回来不重新解密', () => {
    expect(CODE, '结果没有按范围分桶（Record<SearchScope, …>）').toContain('Record<SearchScope, DecryptedEntry[] | null>')
    const body = fnBody('ensureLoaded')
    // 已加载过就返回；force 只给「重试」用
    expect(body, '缺少「这个范围已加载过就返回」的判断 —— 每次切都重新解密全量').toMatch(/!force && entriesByScope\[target\] !== null/)
    expect(CODE, '当前范围的数据不是从桶里取的').toContain('const entries = entriesByScope[scope]')
  })

  it('QS9 归档范围下的空态说人话（不是「没有符合条件的日记」）', () => {
    expect(CODE, '缺少「还没有已归档的日记」这条空态').toContain('还没有已归档的日记')
  })
})
