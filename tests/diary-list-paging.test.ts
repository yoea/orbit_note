// 守卫：列表页游标分页 + 自动加载，以及「按日期筛选」在搜索面板里（2026-10-02 收敛后）。
//
// 历史：2026-10-02 曾在列表页做过「日期胶囊 + 月历 + 锚定窗口 + 双向游标 + prepend 滚动补偿」，
// 真机上滚动补偿不稳（上滑卡顿闪跳）。当天整体删除，按日期筛选搬到搜索面板的时间档里
// （那边把全部条目解密到内存后本地筛，按天筛既精确又完整）。本文件留着**反向断言**，
// 防止那套东西被无意加回来。
//
// 三处「写错了不会报错、只会静默变坏」的地方是本文件的核心：
//   1. 首页判定：只有「从服务器最新一条开始」的那一页才能用来清理本地缓存；
//   2. 缓存写入必须 await（「列表里看得见 ⇒ 本地已有密文」这条离线不变量）；
//   3. IntersectionObserver 的 root 必须是那个滚动容器（用默认 viewport 永不触发且零报错）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot, stripComments } from './class-attrs'

function code(rel: string): string {
  return stripComments(readFileSync(join(projectRoot, rel), 'utf8'))
}

const LIST = 'components/DiaryListView.tsx'
const API = 'app/api/diary/route.ts'
const SEARCH = 'components/SearchDialog.tsx'
const SEARCH_LIB = 'lib/client/search.ts'
const HEATMAP = 'components/ContributionHeatmap.tsx'

// 顺序类断言的统一前置：indexOf 未命中返回 -1，-1 < 正数恒真 ⇒ 不先断言会造成静默空转
function pos(src: string, needle: string): number {
  const i = src.indexOf(needle)
  expect(i, `找不到 ${JSON.stringify(needle)}（后续断言会空转）`).toBeGreaterThan(-1)
  return i
}

describe('L · 服务端列表接口的游标分页', () => {
  it('L0 解析自检（防路径/改名导致的静默空转）', () => {
    expect(code(API).length).toBeGreaterThan(500)
    expect(code(LIST).length).toBeGreaterThan(4000)
  })

  it('L1 支持 (createdAt, id) 元组游标，而不只是按时间比较', () => {
    const src = code(API)
    expect(src, '缺少 before 参数').toContain('before')
    expect(src, '缺少 beforeId 次级键').toContain('beforeId')
    expect(src, '缺少「时间相同再比 id」的元组分支').toMatch(/eq\(diaryEntries\.createdAt[^)]*\)[\s\S]{0,120}lt\(diaryEntries\.id/)
  })

  it('L2 非法输入一律 400，不让 PG 抛 22P02 变成 500', () => {
    const src = code(API)
    expect(src, '缺少 uuid 校验（乱传会让 uuid 比较报错）').toMatch(/UUID_RE/)
    const i = pos(src, "error: 'bad_request'")
    expect(src.slice(i, i + 60), 'bad_request 必须配 400').toContain('400')
  })

  it('L3 带游标时 offset 必须归零（两种分页语义不能叠加）', () => {
    expect(code(API)).toMatch(/offset\(cursor \? 0 : offset\)/)
  })

  it('L4 反向：不得再有反方向的 after 游标（那条链路已删除，留着会被误当能力）', () => {
    const src = code(API)
    expect(src, 'after 方向应已移除').not.toContain('afterId')
    expect(src, '结果反转逻辑应已移除').not.toContain('.reverse()')
  })
})

describe('L · 列表页取数与缓存不变量', () => {
  it('L5 isFirstPage 只在「无游标」时为 true（否则会误清本地缓存）', () => {
    const src = code(LIST)
    expect(src).toMatch(/isFirstPage: from === null/)
    expect(src, 'isFirstPage 不得写死为 true').not.toMatch(/isFirstPage: true/)
  })

  it('L6 列表里出现过的条目必须已落本地密文（await，不能 void）', () => {
    const src = code(LIST)
    expect(src).toMatch(/await cacheEntriesPage\(/)
    expect(src, '不得退回不等待的写法').not.toMatch(/void cacheEntriesPage\(/)
  })

  it('L7 离线也要能翻页（按游标在本地合并数组里定位）', () => {
    const src = code(LIST)
    expect(src, '离线分支缺少游标定位').toContain('startIdx')
    expect(src, '缺少按 id 命中游标的定位').toMatch(/findIndex\(\(e\) => e\.id === from\.id\)/)
  })
})

describe('L · 自动无限滚动', () => {
  it('L8 触底自动加载（不再有「加载更多」按钮）', () => {
    const src = code(LIST)
    expect(src, '缺少 IntersectionObserver').toContain('IntersectionObserver')
    expect(src, '「加载更多」按钮应已删除（浏览不该变成操作）').not.toContain('加载更多')
  })

  it('L9 observer 的 root 必须是滚动容器；标题栏与热力图在滚动容器之外（固定）', () => {
    const src = code(LIST)
    const i = pos(src, 'new IntersectionObserver')
    const opts = src.slice(i, i + 300)
    expect(opts, 'root 未绑定滚动容器：默认 viewport 下永不触发，且不会报错').toMatch(/root,/)
    expect(opts).toContain('rootMargin')
    // ref 与 overflow-y-auto 必须在**同一个元素**上（换布局最容易漏的一处）
    expect(src).toMatch(/<div ref=\{scrollRef\}[^>]*overflow-y-auto/)
    // 固定区：标题栏 + 统计/热力图块都 shrink-0，且都在滚动容器之前
    expect(src, '标题栏必须固定在滚动容器之外').toMatch(/<header[^>]*shrink-0/)
    const mainAt = pos(src, '<main className="mx-auto flex h-full w-full max-w-md flex-col">')
    expect(src.slice(mainAt, mainAt + 200), 'main 不应再是滚动容器').not.toContain('overflow-y-auto')
    const scrollAt = pos(src, 'ref={scrollRef}')
    const shrinkAt = pos(src, '<div className="shrink-0 px-5">')
    expect(shrinkAt, '统计行 + 热力图块必须固定在滚动容器之前').toBeLessThan(scrollAt)
    // 热力图也在滚动容器之前（用顺序断言而不是截取窗口，窗口大小会随代码增长失真）
    expect(pos(src, '<ContributionHeatmap'), '热力图必须属于固定区（在滚动容器之前）').toBeLessThan(scrollAt)
  })

  it('L10 并发闸门读的是 ref（state 是异步的，拦不住同帧多次触发）', () => {
    const src = code(LIST)
    // 断言「闸门读 ref」而不是「某个 ref 被赋值为 true」——后者在闸门被整行删掉时不会变红
    expect(src, '加载缺少 ref 闸门').toMatch(/if \(fetchingRef\.current \|\| !hasMoreRef\.current\) return/)
  })

  it('L11 一次性提示走 Toast，不再内联成一行（否则布局弹跳）', () => {
    const src = code(LIST)
    expect(src, '列表页应使用 Toast').toMatch(/import Toast from '\.\/Toast'/)
    expect(src, 'Toast 必须被渲染').toMatch(/\{toast && <Toast message=\{toast\} \/>\}/)
    expect(src, '不应再有内联 notice 状态').not.toContain('setNotice(')
  })
})

describe('L · 反向：列表页不得再有「按日期跳转/锚定窗口」', () => {
  it('L12 日期入口、锚定状态、双向加载与补偿机制都不得回来', () => {
    const src = code(LIST)
    expect(src, '不得再引 DatePickerDialog').not.toContain('DatePickerDialog')
    expect(src, '不得再有锚定状态').not.toContain('anchor')
    expect(src, '不得再有向上取数').not.toContain('loadNewer')
    expect(src, '不得再有 prepend 补偿').not.toContain('prependAnchorRef')
    expect(src, '不得再出现锚定提示行').not.toContain('已定位到')
    // 日期入口现在只在搜索面板里（下面 L13 正向断言）
    expect(src, '列表页不该出现日期选择文案').not.toContain('按日期')
  })

  it('L13 热力图仍是纯展示（无逐格点击、无日期入口）', () => {
    const src = code(HEATMAP)
    expect(src, '不得有按日期入口').not.toContain('按日期')
    expect(src, '不得有 onOpenPicker 参数').not.toContain('onOpenPicker')
    expect(src, '不得回到「点格子」的交互（格子只有 10×10px）').not.toMatch(/<div[^>]*onClick/)
  })
})

describe('L · 按日期筛选改在搜索面板里', () => {
  it('L14 时间面板里有「具体日期」日历，且只有有记录的日子可点', () => {
    const src = code(SEARCH)
    expect(src, '缺少「具体日期」分组').toContain('具体日期')
    expect(src, '缺少日历组件').toMatch(/function DayPicker\(/)
    expect(src, '日历要列出有记录的日子').toContain('dayKeys')
    expect(src, '没记录/未来的日子必须 disabled').toMatch(/disabled = !hasRecord \|\| isFuture/)
    expect(src, '选中判定必须走 dayRangeKey（编码只有一处）').toMatch(/const isSelected = selected === dayRangeKey\(day\)/)
  })

  it('L15 时间档只剩 all 与 d:，且起止边界与 label 都有分支', () => {
    const src = code(SEARCH_LIB)
    expect(src, 'TimeRange 应只剩 all 与 d: 两档').toContain("export type TimeRange = 'all' | `d:${string}`")
    // 反向：三档快捷筛选（近7天/近30天/具体月份）已按用户要求删除，不得回来
    expect(src, '不得再有 TIME_PRESETS').not.toContain('TIME_PRESETS')
    expect(src, '不得再有月份清单').not.toContain('monthFacets')
    expect(src, '不得再有 7d/30d 档').not.toContain(`'7d'`)
    expect(src, '不得再有 m: 月份档').not.toContain('m:${string}')
    expect(src, '缺少日期解析').toMatch(/function parseDayRange\(/)
    expect(src, 'rangeStart 缺日期分支').toMatch(/const day = parseDayRange\(range\)[\s\S]{0,60}day\.getTime\(\)/)
    expect(src, 'rangeEnd 缺日期分支（次日 0 点，不含）').toMatch(/next\.setDate\(next\.getDate\(\) \+ 1\)/)
    expect(src, '缺少 isDayRange').toContain('export function isDayRange')
    expect(src, '缺少 dayRangeKey').toContain('export function dayRangeKey')
  })
})

describe('L · 从详情返回时恢复滚动位置（2026-10-02 修）', () => {
  it('L16 保存的是「滚动时记下的位置」，不在卸载那一刻读节点', () => {
    const src = code(LIST)
    // 卸载时容器已被 React 摘除，此时 el.scrollTop 读回来是 0 ⇒ 永远存成「顶部」
    expect(src, '缺少滚动位置的 ref').toContain('lastScrollTopRef')
    expect(src, 'scroll 事件里应记录位置').toMatch(/lastScrollTopRef\.current = el\.scrollTop/)
    const saveAt = pos(src, 'const save = () => persist(lastScrollTopRef.current)')
    expect(saveAt).toBeGreaterThan(-1)
    expect(src, '卸载兜底保存不得再读节点').not.toMatch(/persist\(el\.scrollTop\)/)
  })

  it('L17 恢复带按帧重试、且有上限；用户一动就让开', () => {
    const src = code(LIST)
    expect(src, '缺少重试上限').toMatch(/let left = 30/)
    expect(src, '重试必须按帧进行').toMatch(/requestAnimationFrame\(tick\)/)
    expect(src, '赋值后要回读确认是否到位（否则被钳到 0 也算成功）').toMatch(/Math\.abs\(el\.scrollTop - target\) <= 2/)
    expect(src, '用户触摸时放弃重试（不能跟人抢滚动）').toContain("addEventListener('touchstart', cancel")
    expect(src, '用户滚轮时同理').toContain("addEventListener('wheel', cancel")
    expect(src, '位置优先取内存快照（硬刷新后才是 sessionStorage）').toMatch(/snapshot\?\.scrollTop \?\? readScrollState\(\)\?\.y/)
  })
})
