// 守卫：列表页「按日期跳转」+ 自动无限滚动（2026-10-02）。
//
// 这个功能有两处「写错了不会报错、只会静默变坏」的地方，是本文件存在的理由：
//
//   1. **锚定页不能被当成首页喂给 pruneCachedEntries**。缓存清理靠「这是服务器最新那一页」
//      来推断「比它更新的条目已被删除」；锚定页的窗口在时间轴中段，一旦误传 isFirstPage，
//      跳一次日期就会把近期缓存整片判为「已删除」清掉——离线打开近期日记直接「点了没反应」。
//   2. **IntersectionObserver 的 root 必须是本页的滚动容器**。本页是 main 自身
//      overflow-y-auto（容器滚动，见 DiaryListView 的注释），用默认 viewport 会永不触发，
//      表现为「滑到底什么都不会发生」——而且完全没有报错。
//
// 另外两条是「不许退回旧形态」的反向断言：加载更多按钮、以及热力图逐格点击。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot, stripComments } from './class-attrs'

function code(rel: string): string {
  return stripComments(readFileSync(join(projectRoot, rel), 'utf8'))
}

const LIST = 'components/DiaryListView.tsx'
const API = 'app/api/diary/route.ts'
const DIALOG = 'components/DatePickerDialog.tsx'
const HEATMAP = 'components/ContributionHeatmap.tsx'

// 顺序类断言的统一前置：indexOf 未命中返回 -1，-1 < 正数恒真 ⇒ 不先断言会造成静默空转
function pos(src: string, needle: string): number {
  const i = src.indexOf(needle)
  expect(i, `找不到 ${JSON.stringify(needle)}（后续断言会空转）`).toBeGreaterThan(-1)
  return i
}

describe('J · 服务端列表接口的 before 游标', () => {
  it('J0 解析自检（防路径/改名导致的静默空转）', () => {
    expect(code(API).length).toBeGreaterThan(500)
    expect(code(LIST).length).toBeGreaterThan(5000)
  })

  it('J1 支持 (createdAt, id) 元组游标，而不只是按时间比较', () => {
    const src = code(API)
    expect(src, '缺少 before 参数').toContain('before')
    expect(src, '缺少 beforeId 次级键').toContain('beforeId')
    // 元组比较：同一秒多条（Day One 导入是秒级精度）时只按时间比会整批跳过
    expect(src, '缺少「时间相同再比 id」的元组分支').toMatch(/eq\(diaryEntries\.createdAt[^)]*\)[\s\S]{0,120}lt\(diaryEntries\.id/)
  })

  it('J2 非法输入一律 400，不让 PG 抛 22P02 变成 500', () => {
    const src = code(API)
    expect(src, '缺少 uuid 校验（乱传会让 uuid 比较报错）').toMatch(/UUID_RE/)
    const i = pos(src, "error: 'bad_request'")
    // 状态码写在 error 之后，所以看**后面**这一小段
    expect(src.slice(i, i + 60), 'bad_request 必须配 400').toContain('400')
  })

  it('J3 带游标时 offset 必须归零（两种分页语义不能叠加）', () => {
    const src = code(API)
    expect(src).toMatch(/offset\(cursor \? 0 : offset\)/)
  })
})

describe('J · 列表页取数与缓存不变量', () => {
  it('J4 锚定页绝不当成首页——isFirstPage 只在无游标时为 true', () => {
    const src = code(LIST)
    expect(src).toMatch(/isFirstPage: from === null/)
    expect(src, 'isFirstPage 不得写死为 true').not.toMatch(/isFirstPage: true/)
  })

  it('J5 列表里出现过的条目必须已落本地密文（await，不能 void）', () => {
    const src = code(LIST)
    expect(src).toMatch(/await cacheEntriesPage\(/)
    expect(src, '不得退回不等待的写法').not.toMatch(/void cacheEntriesPage\(/)
  })

  it('J6 离线也要能翻页，且跳转要求本地真有那一天（不许撒谎）', () => {
    const src = code(LIST)
    expect(src, '离线分支缺少游标定位').toContain('startIdx')
    expect(src, '缺少「本地没有那一天」的判定').toContain('offline-jump')
    expect(src, '缺少按 id 命中游标的定位').toMatch(/findIndex\(\(e\) => e\.id === from\.beforeId\)/)
  })
})

describe('J · 自动无限滚动', () => {
  it('J7 触底自动加载（不再有「加载更多」按钮）', () => {
    const src = code(LIST)
    expect(src, '缺少 IntersectionObserver').toContain('IntersectionObserver')
    expect(src, '「加载更多」按钮应已删除（浏览不该变成操作）').not.toContain('加载更多')
  })

  it('J8 IntersectionObserver 的 root 必须是本页滚动容器（不是 viewport）', () => {
    const src = code(LIST)
    const i = pos(src, 'new IntersectionObserver')
    const opts = src.slice(i, i + 300)
    expect(opts, 'root 未绑定滚动容器：默认 viewport 下永不触发，且不会报错').toMatch(/root,/)
    expect(opts).toContain('rootMargin')
    // 滚动容器就是那个 overflow-y-auto 的 main
    expect(src).toMatch(/<main ref=\{scrollRef\}[^>]*overflow-y-auto/)
  })

  it('J9 并发闸门用 ref（state 是异步的，拦不住同帧多次触发）', () => {
    const src = code(LIST)
    expect(src).toMatch(/fetchingRef\.current = true/)
  })
})

describe('J · 日期跳转的交互契约', () => {
  it('J10 锚定条给出「已定位到 X」与「回到最新」', () => {
    const src = code(LIST)
    expect(src).toContain('已定位到')
    expect(src, '缺回到最新的入口：跳过去就回不来了').toContain('回到最新')
  })

  it('J11 跳转是重新锚定（带 before=当天末刻），不是滚动', () => {
    const src = code(LIST)
    expect(src, '跳转必须用 dayEndIso 生成边界').toMatch(/dayEndIso\(/)
    expect(src, '锚定后应回到顶部，而不是保留旧滚动位置').toMatch(/scrollTop = 0/)
  })

  it('J12 锚定日期进快照与 sessionStorage（切 tab / 返回详情都要回到同一天）', () => {
    const src = code(LIST)
    expect(src, 'sessionStorage 里少了 anchor').toMatch(/count: itemsRef\.current\.length, anchor: anchorRef\.current/)
    expect(src, '快照里少了 anchor').toMatch(/snapshot = \{[^}]*anchor[^}]*\}/)
  })

  it('J13 日期弹层：底部按钮用共享常量，空日子不可点', () => {
    const src = code(DIALOG)
    expect(src).toContain('DIALOG_FOOTER_BUTTON_CLASS')
    expect(src, '没记录/未来的日子必须 disabled（否则点出空列表）').toMatch(/disabled = count === 0 \|\| isFuture/)
    expect(src, '月历网格固定 6 行，高度不跳').toContain('monthGrid')
  })

  it('J14 热力图不做逐格点击（10px 格子点不准），改为「按日期查找」入口', () => {
    const src = code(HEATMAP)
    expect(src, 'onOpenPicker 必须是可选参数（其它页面不传时应保持原样）').toMatch(/onOpenPicker\?: \(\) => void/)
    expect(src, '入口文案缺失').toContain('按日期查找')
    // 反向：格子元素上不得挂点击处理器
    expect(src, '不得回到「点格子」的交互（格子只有 10×10px）').not.toMatch(/<div[^>]*onClick/)
  })
})
