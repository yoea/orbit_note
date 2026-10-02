// 守卫：TabBar 之间切换页面时不得重放「入场动画」，列表页也不得每次挂载都从空白重来。
//
// 背景（2026-09-30 用户反馈）：在底部 TabBar 之间切换时，「每次切换到新页面都疑似从服务器
// 全量刷新，从写页切到列表页会出现约零点几秒的闪动，能明显感知从白屏到内容出现」。
//
// 两条真实成因（都与「服务器」无关，是客户端自己的事）：
//   1. `animate-fade-in`（0.3s，opacity 0 → 1）挂在三个 tab 页各自的根节点上。TabBar 的三个
//      目的地是三个独立 page 组件，切换时**卸载/重新挂载** ⇒ 动画每次重放一遍 ⇒ 白屏闪动。
//      CSS 动画是「挂载即播」，没有别的开关。
//   2. 列表页（DiaryListView）状态全是空初值，每次挂载都重跑「两个请求 + 逐条解密」，
//      期间还会错误地渲染「还没有日记」（数据还在路上 ≠ 没有日记）。
//
// 修法：① 淡入移到 (app)/layout 的 children 包裹层——同一路由组内 layout **不会重新挂载**，
// 等于「整个应用就绪时淡入一次」；② 列表页加会话级内存快照，首帧先用上次的内容渲染
// （后台照常重取覆盖），并用 loading 区分「空」与「还没到」。
//
// 断言前一律剥离注释：本文件顶部与源码里的说明文字都会引用 `animate-fade-in` 这类字样，
// 不剥的话「必须包含」的断言会被注释喂成假通过、「禁止出现」的断言会被注释打红
// （footnote-contrast.test.ts / markdown-layout.test.ts 同款做法）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot, stripComments } from './class-attrs'

function code(rel: string): string {
  return stripComments(readFileSync(join(projectRoot, rel), 'utf8'))
}

// tab 目的地页的根组件 + 三个 page 入口。它们**都会**在切 tab 时重新挂载。
const TAB_PAGES = [
  'components/DiaryEditor.tsx',
  'components/DiaryListView.tsx',
  'components/SettingsView.tsx',
  'app/(app)/page.tsx',
  'app/(app)/diary/page.tsx',
  'app/(app)/settings/page.tsx',
]

describe('T · 页面切换不重放入场动画', () => {
  it('T0 解析自检：能读到这些文件（防空转）', () => {
    for (const f of TAB_PAGES) {
      expect(code(f).length, `${f} 读不到内容，后面的断言会空转`).toBeGreaterThan(100)
    }
    expect(code('app/(app)/layout.tsx').length).toBeGreaterThan(500)
  })

  it.each(TAB_PAGES)('T1 %s 的根节点不再挂 animate-fade-in', (file) => {
    expect(
      code(file),
      `${file} 又挂上了 animate-fade-in —— 本组件每次切 tab 都会重新挂载，
      CSS 动画随之重放（0.3s 从 opacity 0 淡入），用户看到的就是「白屏闪一下再出内容」。
      淡入只应挂在 (app)/layout 的 children 包裹层（它不重新挂载）。`,
    ).not.toContain('animate-fade-in')
  })

  it('T2 (app)/layout 里淡入挂在 children 的包裹层上（不是 TabBar）', () => {
    const src = code('app/(app)/layout.tsx')
    expect(
      src,
      '找不到「带 animate-fade-in 且直接包裹 {children}」的元素——淡入必须在不会重新挂载的 layout 上',
    ).toMatch(/<div[^>]*className="[^"]*animate-fade-in[^"]*"[^>]*>\{children\}<\/div>/)
  })
})

describe('T · 列表页首帧不再从空白重来', () => {
  const FILE = 'components/DiaryListView.tsx'

  it('T3 有模块级会话快照，state 初值直接读它', () => {
    const src = code(FILE)
    expect(src, '没有模块级快照：切 tab 回来就要重跑「请求 + 逐条解密」，那段时间页面是空的')
      .toMatch(/^let snapshot\b/m)
    expect(src, 'useState 的初始化器没有读快照（首帧仍然是空列表）')
      .toMatch(/useState<[^>]*>\(\(\) => snapshot\?\.items/)
  })

  it('T4 快照会被回写（否则只有第一次进来有内容，之后永远为空）', () => {
    const src = code(FILE)
    // 只断言「被回写、且关键字段都在」，不锁死整个字段列表——
    // 字段会随功能增长（2026-10-02 加了 cursor 与 anchor），锁死会让守卫变成
    // 「每次加一个视图字段就被迫改一次测试」，反而诱使人删掉它。
    const m = src.match(/snapshot = \{([^}]*)\}/)
    expect(m, '没有把最新状态写回快照').not.toBeNull()
    const fields = m![1]
    // hasOlder 于 2026-10-02 由 hasMore 改名（分页改双向游标后，hasMore 的语义不再唯一）
    for (const k of ['items', 'stats', 'hasOlder']) {
      expect(fields, `快照漏了 ${k}`).toContain(k)
    }
    // anchor（日期跳转后的锚定日期）属于视图状态：漏了它，切个 tab 回来会莫名其妙回到「最新」
    expect(fields, '快照漏了 anchor：锚定视图切 tab 回来会丢失').toContain('anchor')
  })

  it('T5 「还没有日记」由 !loading 守着（加载中不能说成没有日记）', () => {
    const src = code(FILE)
    const at = src.indexOf('还没有日记')
    // 先确认找得到：indexOf 未命中返回 -1，不做这一步的话后面的断言会在「文案被删掉」时反向通过
    expect(at, '找不到空态文案，后面的断言会空转').toBeGreaterThan(0)
    expect(
      src.slice(Math.max(0, at - 200), at),
      '空态缺少 loading 守卫：切 tab 时会先闪一行「还没有日记」，再被真实列表顶掉',
    ).toContain('!loading')
  })

  it('T6 重取至少补齐到「本次挂载时已有的深度」（后台刷新不能让列表缩水）', () => {
    const src = code(FILE)
    expect(src, '缺少 seededDepthRef —— 快照比上次浏览深度长时，刷新回来列表会缩水、滚动跳位')
      .toContain('seededDepthRef')
    expect(src).toMatch(/Math\.max\(restore\?\.count \?\? 0, seededDepthRef\.current\)/)
  })
})
