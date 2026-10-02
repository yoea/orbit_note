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
    expect(src, '缺少按 id 命中游标的定位').toMatch(/findIndex\(\(e\) => e\.id === from\.id\)/)
  })

  it('J6b 向上（更新一页）方向离线明确拒绝，不给出可能缺条的窗口', () => {
    const src = code(LIST)
    expect(src, '离线向上取数必须显式失败').toContain('offline-newer')
  })
})

describe('J · 自动无限滚动', () => {
  it('J7 触底自动加载（不再有「加载更多」按钮）', () => {
    const src = code(LIST)
    expect(src, '缺少 IntersectionObserver').toContain('IntersectionObserver')
    expect(src, '「加载更多」按钮应已删除（浏览不该变成操作）').not.toContain('加载更多')
  })

  it('J8 两个方向的 observer 的 root 都必须是滚动容器（不是 viewport）', () => {
    const src = code(LIST)
    const i = pos(src, 'new IntersectionObserver')
    const opts = src.slice(i, i + 300)
    expect(opts, 'root 未绑定滚动容器：默认 viewport 下永不触发，且不会报错').toMatch(/root,/)
    expect(opts).toContain('rootMargin')
    // ★ 2026-10-02 布局改为「固定标题栏 + 内部滚动区」后，滚动容器从 <main> 变成内层 div：
    //   这里断言 ref 与 overflow-y-auto 挂在**同一个元素**上（换布局最容易漏的一处）
    expect(src).toMatch(/<div ref=\{scrollRef\}[^>]*overflow-y-auto/)
  })

  it('J8b 标题栏在滚动容器之外（固定），列表区自己滚', () => {
    const src = code(LIST)
    expect(src, '标题栏必须 shrink-0 且不在滚动容器内').toMatch(/<header[^>]*shrink-0/)
    // 滚动容器是 main 的直接子元素（与 TabBar 一样待在滚动区之外的是标题栏）
    const mainAt = pos(src, '<main className="mx-auto flex h-full w-full max-w-md flex-col">')
    const scrollAt = pos(src, 'ref={scrollRef}')
    const headerAt = pos(src, '<header')
    expect(headerAt, '标题栏应在滚动容器之前').toBeLessThan(scrollAt)
    // main 自身不得再是滚动容器
    expect(src.slice(mainAt, mainAt + 200), 'main 不应再是滚动容器').not.toContain('overflow-y-auto')
  })

  it('J9 并发闸门读的是 ref（state 是异步的，拦不住同帧多次触发）', () => {
    const src = code(LIST)
    // 两个方向各一把闸门：向下 fetchingOlderRef、向上 fetchingNewerRef（2026-10-02 双向化）。
    // 断言「闸门读 ref」而不是「某个 ref 被赋值为 true」——后者在闸门被整行删掉时不会变红。
    expect(src, '向下加载缺少 ref 闸门').toMatch(/if \(fetchingOlderRef\.current \|\| !hasOlderRef\.current\) return/)
    expect(src, '向上加载缺少 ref 闸门').toMatch(/if \(fetchingNewerRef\.current \|\| !hasNewerRef\.current\) return/)
  })
})

describe('J · 日期跳转的交互契约', () => {
  it('J10 锚定状态内联在胶囊里，且「回到最新」永远可达', () => {
    const src = code(LIST)
    // 状态收进胶囊（✕ 即回到最新）——不再单独占一行，避免布局弹跳
    expect(src, '缺少「回到最新」操作').toContain('aria-label="回到最新"')
    expect(src, '胶囊要能显示锚定日期').toMatch(/anchor \? jumpDayLabel\(anchor\) : '按日期'/)
    // 反向：内联的锚定行不得回来（它会在滚动区里凭空多一行、且滑下去就看不见）
    expect(src, '锚定提示不应再是独立一行').not.toContain('已定位到')
  })

  it('J11 跳转是重新锚定（带 before=当天末刻），不是滚动', () => {
    const src = code(LIST)
    expect(src, '跳转必须用 dayEndIso 生成边界').toMatch(/dayEndIso\(/)
    // 锚定后回到顶部、并复位「向上滚动过」标记 —— 统一走 resetScrollTo，别在两处各写一遍
    expect(src, '锚定后应回到顶部').toMatch(/resetScrollTo\(0, day\)/)
    expect(src, '回到最新也要回到顶部').toMatch(/resetScrollTo\(0, null\)/)
    const i = pos(src, 'function resetScrollTo')
    const body = src.slice(i, i + 400)
    expect(body, 'resetScrollTo 必须真的设置 scrollTop').toMatch(/el\.scrollTop = top/)
    expect(body, 'resetScrollTo 必须复位向上滚动标记').toContain('userScrolledUpRef.current = false')
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

  it('J14 热力图是纯展示（无逐格点击，也不再挂重复的日期入口）', () => {
    const src = code(HEATMAP)
    // 反向：日期入口已收敛到页头胶囊（热力图受偏好控制，关掉它入口就没了）
    expect(src, '热力图下不应再有「按日期查找」入口（与页头胶囊重复）').not.toContain('按日期查找')
    expect(src, '不得再有 onOpenPicker 参数').not.toContain('onOpenPicker')
    // 反向：格子元素上不得挂点击处理器（格子只有 10×10px）
    expect(src, '不得回到「点格子」的交互').not.toMatch(/<div[^>]*onClick/)
  })
})

describe('J · 锚定后的双向滚动（2026-10-02 修）', () => {
  it('J15 服务端支持 after 方向：元组比较 + 升序取紧邻若干条 + 反转回 desc', () => {
    const src = code(API)
    expect(src, '缺少 after 参数').toContain('after')
    expect(src, 'after 方向缺少元组比较').toMatch(/gt\(diaryEntries\.createdAt[^)]*\)[\s\S]{0,140}gt\(diaryEntries\.id/)
    expect(src, 'after 方向必须按升序取「紧邻上方的 N 条」').toMatch(/cursor\?\.dir === 'newer' \? asc : desc/)
    expect(src, '返回前必须反转回 desc（客户端按 desc 渲染/分组）').toMatch(/\[\.\.\.rows\]\.reverse\(\)/)
  })

  it('J16 两个方向互斥，同时给一律 400', () => {
    const src = code(API)
    const i = pos(src, 'if (beforeRaw && afterRaw)')
    expect(src.slice(i, i + 160), 'before 与 after 同时给必须拒绝').toContain('400')
  })

  it('J17 prepend 必须补偿滚动位置（否则正在看的条目被推走）', () => {
    const src = code(LIST)
    expect(src, '缺少 prepend 前的高度快照').toMatch(/prependAnchorRef\.current = \{ height: el\.scrollHeight, top: el\.scrollTop \}/)
    expect(src, '补偿必须在布局阶段完成（绘制前）').toMatch(/useLayoutEffect/)
    expect(src, '缺少按高度差补偿 scrollTop').toMatch(/el\.scrollTop = a\.top \+ delta/)
  })

  it('J18 顶部哨兵必须由「用户主动向上滚动」放行（防跳转后连环加载）', () => {
    const src = code(LIST)
    expect(src, '缺少向上滚动标记').toContain('userScrolledUpRef')
    const i = pos(src, 'userScrolledUpRef.current = true')
    expect(src.slice(Math.max(0, i - 200), i), '标记应由向上滚动产生').toContain('lastScrollTopRef')
    // 顶部 observer 的回落里要有这道闸门
    const ioAt = src.lastIndexOf('if (!userScrolledUpRef.current) return')
    expect(ioAt, '顶部加载缺少闸门判断').toBeGreaterThan(-1)
    expect(src.slice(ioAt, ioAt + 120)).toContain('loadNewer')
  })

  it('J19 够到全库最新时自动解除锚定（避免「已到最新却还写着已定位」）', () => {
    const src = code(LIST)
    const i = pos(src, 'page.serverCount < PAGE_SIZE')
    const body = src.slice(i, i + 200)
    expect(body, '到顶后必须解除锚定').toContain('setAnchor(null)')
    expect(body, '到顶后不应再尝试向上加载').toContain('setHasNewer(false)')
  })

  it('J20 一次性提示走 Toast，不再内联成一行（否则布局弹跳）', () => {
    const src = code(LIST)
    expect(src, '列表页应使用 Toast').toMatch(/import Toast from '\.\/Toast'/)
    expect(src, 'Toast 必须被渲染').toMatch(/\{toast && <Toast message=\{toast\} \/>\}/)
    // 反向：不再有内联提示行
    expect(src, '不应再有内联 notice 状态').not.toContain('setNotice(')
  })

  it('J21 快照与 sessionStorage 都带 anchor（切 tab / 返回详情回到同一天）', () => {
    const src = code(LIST)
    expect(src).toMatch(/snapshot = \{[^}]*anchor[^}]*\}/)
    expect(src).toMatch(/anchor: anchorRef\.current/)
  })
})
