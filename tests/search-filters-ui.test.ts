import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot } from './class-attrs'

// ============================================================================
// 搜索筛选栏的结构守卫（源码级 —— 本仓库测试环境是 node、没有 jsdom，
// 客户端组建的交互无法真实渲染；同族的 entry-tail-row / settings-structure 也是这么做的）
//
// 背景（2026-09-30 用户报「按地点筛选不显示结果」）：
//   筛选的**纯逻辑**（lib/client/search.ts 的 matches）一直是对的——tests/search.test.ts
//   的 C2/C3 就钉着「选地名 = 该地点全部条目」「收藏 ∩ 地名」；坏的是 UI 接线：
//   面板里的地点清单是从**已解密条目**现取的，而打开面板只 setOpenPanel(true)、
//   没有触发 ensureLoaded()，于是「进搜索 → 直接点地点」永远是空面板，压根选不出地点。
//   ⇒ 本文件的核心是 F2：`setOpenPanel` 只允许出现在 openFilterPanel() 里，
//   且那个函数体必须调用 ensureLoaded()。这是本次事故唯一的防回归点。
//
// 另一条主线是「三类」：时间 / 收藏 / 地点（用户 2026-09-30 定的信息架构）。
// 「只看有位置」不再单独占 chip，而是降为地点面板里的第二档。
// ============================================================================

const REL = 'components/SearchDialog.tsx'

/** 剥掉注释再断言：本文件的说明文字里就写着 `setOpenPanel` / `ensureLoaded`，
 *  不剥会让 F2 在自己描述的 bug 上误判（旧版 footnote 守卫踩过同类坑）。 */
function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释（含 JSX 里的 {/* … */}）
    .replace(/^\s*\/\/.*$/gm, '')     // 整行行注释
}

const CODE = stripComments(readFileSync(join(projectRoot, REL), 'utf8'))

/** 非空转 helper：命中位置必须存在，否则顺序类断言会因为 indexOf 返回 -1 而恒真 */
function at(hay: string, needle: string): number {
  const i = hay.indexOf(needle)
  expect(i, `锚点未找到：${needle}`).toBeGreaterThanOrEqual(0)
  return i
}

/** 取一个函数的源码原文（从 `function name(` 到下一个两空格缩进的右括号） */
function fnBody(name: string): string {
  const start = at(CODE, `function ${name}(`)
  const end = CODE.indexOf('\n  }', start)
  expect(end, `函数 ${name} 的右括号未找到`).toBeGreaterThan(start)
  return CODE.slice(start, end + 4)
}

describe('搜索筛选栏：三类筛选（时间 / 收藏 / 地点）', () => {
  it('F0 解析自检：拿到的是 SearchDialog 的源码，且注释确实被剥掉了', () => {
    // 防空转：路径写错时下面所有断言都会在「一个锚点都找不到」的情况下红，
    // 但这里先给一条语义明确的失败信息
    expect(CODE.length).toBeGreaterThan(2000)
    expect(CODE).toContain('export default function SearchDialog')
    expect(CODE).not.toContain('筛选归为**三类**') // 说明性注释必须已被剥离
  })

  it('F1 三类控件都在，且顺序为 时间 → 收藏 → 地点', () => {
    const time = at(CODE, "openFilterPanel('time')")
    const star = at(CODE, 'onClick={toggleStarred}')
    const place = at(CODE, "openFilterPanel('location')")
    expect(time).toBeLessThan(star)
    expect(star).toBeLessThan(place)
  })

  it('F2 ★ 打开面板必须触发惰性解密加载——所有「开」面板的调用都在 openFilterPanel 里', () => {
    const start = at(CODE, 'function openFilterPanel(')
    const end = CODE.indexOf('\n  }', start) + 4
    expect(end).toBeGreaterThan(start)

    // 逐个扫描 setOpenPanel(...)：收起的写法是 setOpenPanel(null)，不需要加载（点击本来就已解锁）；
    // 只有「开出某个面板」的调用才必须伴随 ensureLoaded()
    const openers: number[] = []
    const re = /setOpenPanel\(/g
    for (let m = re.exec(CODE); m; m = re.exec(CODE)) {
      const arg = CODE.slice(m.index + m[0].length, m.index + m[0].length + 4)
      if (!arg.startsWith('null')) openers.push(m.index)
    }
    expect(openers.length).toBeGreaterThan(0)
    for (const i of openers) {
      expect(i, '有 setOpenPanel 在 openFilterPanel 之外开面板 —— 会漏掉 ensureLoaded()，面板永远是空的').toBeGreaterThanOrEqual(start)
      expect(i, '同上').toBeLessThan(end)
    }
    expect(CODE.slice(start, end)).toContain('ensureLoaded()')
  })

  it('F3 时间面板：预设档来自 TIME_PRESETS，且刻意没有「今年」这一档', () => {
    expect(CODE).toContain('TIME_PRESETS.map')
    // 旧实现有 'year' 档；再出现即说明有人把它加回来了（用户明确只要 全部/7天/30天/月份）
    expect(CODE).not.toContain("'year'")
    expect(CODE).not.toContain('今年')
  })

  it('F4 时间面板含月份清单（从数据现取，不是让用户自己选年月）', () => {
    expect(CODE).toContain('monthFacets')
    expect(CODE).toContain('months.map')
    expect(CODE).toContain('按月份')
  })

  it('F5 地点面板：不限 / 只看有位置 / 具体地点 三档都在', () => {
    expect(CODE).toContain('全部地点')
    expect(CODE).toContain('只看有位置')
    expect(CODE).toContain('facets.map')
    // 「有位置」不再单独占一个 chip（旧实现的独立 chip 文案就是这两个字）
    expect(CODE).not.toContain("onClick={() => { setOnlyWithLocation(!onlyWithLocation)")
  })

  it('F6 收藏是即时开关：没有面板可开，且两态文案区分得开', () => {
    const body = fnBody('toggleStarred')
    expect(body).toContain('setOnlyStarred')
    expect(body).toContain('resetPaging()')
    expect(CODE).toContain("onlyStarred ? '仅收藏' : '收藏'")
  })

  it('F7 旧的并列 chip 写法不得回流（4 个时间 chip + 独立「有位置」）', () => {
    expect(CODE).not.toContain('TIME_RANGES')
    expect(CODE).not.toContain('TIME_RANGE_LABEL')
    expect(CODE).not.toContain('setLocationOpen')
  })

  it('F8 面板的空态走同一套加载/空/失败口径（不再出现「还没加载就说没有地点」）', () => {
    expect(CODE).toContain('正在解密日记…')
    expect(CODE).toContain('还没有记录过地点')
    expect(CODE).toContain('还没有日记')
    // 空态必须区分「还没加载完」与「真的没有」——PanelHint 靠 loaded 判断
    expect(CODE).toContain('loaded={entries !== null}')
    expect(CODE).toContain('日记加载失败')
  })

  it('F9「重置」只管筛选，不碰关键词（关键词由输入框自己的 ✕ 清除）', () => {
    const body = fnBody('resetFilters')
    expect(body).toContain("setRange('all')")
    expect(body).not.toContain('setQuery(')
    // 按钮只在筛选非默认时出现
    expect(CODE).toContain('{filtersActive && (')
  })
})
