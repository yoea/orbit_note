// 守卫：查看页底部的两个区域 —— 「编辑于」行 + 4 图标操作栏。
//
// ★ 2026-09-30 用户要求的三处调整（此前的 F1~F6 是围绕「内容尾行」写的，已整体改写）：
//   1. 打开次数从尾行搬进操作栏、排在**收藏之前**，四个图标统一 18px / strokeWidth 2；
//   2. 收藏**去掉文字标签**，状态只由星形表达（实心 = 已收藏）；
//   3. 「编辑于」不再跟着正文往上浮 —— 用 `mt-auto` 钉在分割线**正上方**，字号再降一档。
//
// ★ 这里最容易踩的两个坑（都在本文件里防着）：
//   · `indexOf` 未命中返回 -1，而 `-1 < 正数` 恒真 ⇒ 所有比较前先断言下标 >= 0
//     （否则「目标被删掉」时断言反而会通过）。
//   · 断言用的锚点必须是**只出现一次**的完整串。例如 `已收藏` 只出现在注释里（注释已被
//     stripComments 剥掉），所以「不许再出现收藏文字」这条能直接对全文断言。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classAttrsIn, classTokens, projectRoot, stripComments } from './class-attrs'

const FILE = 'components/EntryView.tsx'
const src = stripComments(readFileSync(join(projectRoot, FILE), 'utf8'))
const attrs = classAttrsIn(FILE, src)

/** 曾钉在底部的「编辑于」留白行 —— 2026-10-09 已废除，**不得再出现** */
const LEGACY_DATE_ROW = 'mt-auto pt-8 pb-3'
/** 操作栏的 class（分割线 + 上下内边距，唯一） */
const BAR = 'border-t border-neutral-100 py-4'
/** 查看态正文滚动容器的 class（唯一） */
const BODY = 'mt-4 min-h-0 flex-1 overflow-y-auto'

function indexOrFail(needle: string): number {
  const i = src.indexOf(needle)
  expect(i, `${FILE} 里找不到「${needle}」，后面的比较会空转`).toBeGreaterThanOrEqual(0)
  return i
}

/** 求一段 `<div …>` 的配对闭合区间（`<div` / `</div>` 配平）。
 *  为什么需要它：判断某个元素是滚动区的**子节点**还是**兄弟节点**，看源码下标是看不出来的
 *  （两种情况下标都可能“在后面”），必须真的配平才能定归属。 */
function divRange(source: string, start: number): [number, number] | null {
  const re = /<div\b|<\/div>/g
  re.lastIndex = start
  let depth = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    if (m[0] === '</div>') {
      depth--
      if (depth <= 0) return [start, m.index + m[0].length]
    } else depth++
  }
  return null
}

/** 操作栏那一段源码（从分割线起到 </main> 止） */
function barSlice(): string {
  const start = indexOrFail(BAR)
  const end = src.indexOf('</main>', start)
  expect(end, '操作栏之后找不到 </main>，切片会取到空串').toBeGreaterThan(start)
  return src.slice(start, end)
}

/** 从 needle 起取一段固定长度的窗口（"某个按钮的源码" 这类局部断言用）。
 *  ⚠️ 不要写 `hay.slice(hay.indexOf(x), 900)` —— 那是**绝对下标**不是长度，
 *  一旦 x 出现在 900 之后就会得到空串，后面的断言全部静默空转（这里踩过一次）。 */
function windowFrom(hay: string, needle: string, len: number): string {
  const i = hay.indexOf(needle)
  expect(i, `窗口锚点「${needle}」找不到，后面的断言会空转`).toBeGreaterThanOrEqual(0)
  return hay.slice(i, i + len)
}

describe('F · 查看页底部（编辑于行 + 4 图标操作栏）', () => {
  it('F0 解析自检：锚点齐全（防断言空转）', () => {
    expect(src.length).toBeGreaterThan(2000)
    for (const needle of ['MarkdownBoundary', '编辑于', '打开过', BODY, BAR, '-mr-2', 'fmtDate', 'showViews && (']) {
      expect(src, `找不到锚点「${needle}」`).toContain(needle)
    }
    // 被废除的留白行必须**已经不在**（正文本行内容 + 注释里提到它，注释已被剥掉）
    expect(src, `已废除的留白行 ${LEGACY_DATE_ROW} 仍在源码里`).not.toContain(LEGACY_DATE_ROW)
    expect(attrs.length, '没能解析出任何 class 属性').toBeGreaterThan(10)
  })

  it('F1 「编辑于」在**顶部信息行**里（与「日期 · 字数」同一行），且不在正文/底部', () => {
    // 2026-10-09 用户要求把「编辑于」并进顶部信息行。
    // 原因：它原先钉在底部分割线正上方，在正文与操作栏之间占掉 61px，使正文滚到底也
    // 够不到分割线（用户反馈「内容最下方多出一块空白、内容区没把中间这部分用满」）。
    const created = indexOrFail('fmtDate(created)')
    const edited = indexOrFail('编辑于')
    const bodyAt = indexOrFail(BODY)
    expect(edited, '「编辑于」跑到创建时间前面去了').toBeGreaterThan(created)
    expect(edited, '「编辑于」不在顶部信息行 —— 它跑到正文或底部去了').toBeLessThan(bodyAt)
  })

  it('F2 底部不得再有任何留白行（正文滚动区与操作栏必须紧邻）', () => {
    // ★ `mt-auto` 在有 `flex-1` 兄弟（正文）时是**空操作** —— flex-grow 先把剩余空间吃光了，
    //   所以 `mt-auto pt-8 pb-3` 那 61px 恒定存在、正文永远够不到它。
    //   这就是用户看到的「内容最下方多出一块空白」，也让他觉得「滚到底了还滑不动」。
    expect(src, '底部的「编辑于」留白行又回来了 —— 正文会被它挡住 61px').not.toContain(LEGACY_DATE_ROW)
    expect(src, '底部又出现了 pt-8 这种大留白').not.toContain('pt-8')
  })

  it('F3 操作栏两端对齐，且**打开次数排在收藏之前**（用户要求「排在最前」）', () => {
    const barAttrs = attrs.filter((a) => a.text.includes(BAR))
    expect(barAttrs.length, '找不到操作栏的 class 属性').toBe(1)
    const tokens = classTokens(barAttrs[0].text)
    expect(tokens, '操作栏没有两端对齐（左＝状态组、右＝操作组）').toContain('justify-between')
    // mt-auto 已经交给「编辑于」那一行；操作栏自己不再需要它（两者都写会平分剩余空间）
    expect(tokens, 'mt-auto 归「编辑于」行所有，操作栏不该再写').not.toContain('mt-auto')

    const divider = indexOrFail(BAR)
    const eye = indexOrFail('showViews && (')
    const star = indexOrFail('() => void toggleStar()')
    const iconGroup = indexOrFail('-mr-2')
    expect(eye, '打开次数还在分割线上方（那是「编辑于」那一行的地盘）').toBeGreaterThan(divider)
    expect(star, '收藏按钮跑到编辑/删除右边去了（它属于左组）').toBeLessThan(iconGroup)
    expect(eye, '打开次数没有排在收藏前面').toBeLessThan(star)
  })

  it('F4 打开次数是「图标 + 数字」且有可访问标签（不再退回 14px 的小图标）', () => {
    const bar = barSlice()
    expect(bar, '操作栏里找不到打开次数').toContain('打开过')
    expect(bar, '打开次数没有可访问标签（图标 + 裸数字对屏幕阅读器等于噪声）').toContain('role="img"')
    // 眼睛图标与星/编辑/删除同尺寸（原先它是 h-3.5 w-3.5，视觉上属于另一档）
    const eyeLine = windowFrom(bar, 'showViews && (', 900)
    expect(eyeLine, '眼睛图标不是 18px，与其它三个图标不统一').toContain('h-[18px] w-[18px]')
    // 恒渲染（2026-10-01 定）：`viewCount > 0` 条件渲染会让 0 次文章首次打开时
    // 图标在计数返回后凭空插入 DOM = 布局闪现。现在只允许偏好开关做条件。
    expect(eyeLine, '眼睛又变回「次数 > 0 才渲染」——0→1 会布局闪现').not.toContain('viewCount > 0')
  })

  it('F5 收藏只剩图标两态 —— 不得再出现收藏的文字标签', () => {
    // `已收藏` 作为**文案**只可能出现在 star 按钮里；注释里的说明已被 stripComments 剥掉，
    // 所以这一条能直接对全文断言（命中即说明有人把文字加回来了）。
    expect(src, '收藏文字标签又回来了（用户要求「仅通过图标状态变化表示收藏状态」）').not.toContain('已收藏')
    const star = windowFrom(barSlice(), '() => void toggleStar()', 700)
    expect(star, '收藏按钮里还在渲染文字').not.toMatch(/<span[^>]*>[^<]*收藏/)
    // 图标成了唯一的视觉信号 ⇒ 这两条（无障碍 + 桌面 tooltip）绝不能删
    expect(star, '少了 aria-pressed，屏幕阅读器读不出收藏状态').toContain('aria-pressed')
    expect(star, '少了 aria-label，屏幕阅读器读不出按钮用途').toContain('aria-label')
    expect(star, '少了 title，桌面端没有 tooltip（移动端本来就没有 hover）').toContain('title=')
  })

  it('F6 「编辑于」不在操作栏里', () => {
    expect(barSlice(), '「编辑于」又被放回操作栏了——那它就不是「钉在分割线上方」了').not.toContain('编辑于')
  })

  it('F7 四个图标的尺寸与线宽统一（打开次数 / 收藏 / 编辑 / 删除）', () => {
    const bar = barSlice()
    const sizes = bar.match(/h-\[18px\] w-\[18px\]/g) ?? []
    expect(sizes.length, '操作栏里不是 4 个 18px 图标（打开次数、收藏、编辑、删除）').toBe(4)
    // 三个内联 SVG（眼睛 / 编辑 / 删除）都用 strokeWidth 2；星是填充图形，线宽在 StarIcon 内部
    const strokes = bar.match(/strokeWidth="2"/g) ?? []
    expect(strokes.length, '内联图标的线宽不统一').toBe(3)
  })

  it('F8 正文滚动区与操作栏之间不得夹任何元素（滚动区下边缘 = 操作栏上边缘）', () => {
    // 2026-10-09 用户要求（原文）：「我希望内容区域最下部分能和 [操作栏] 的上边缘重合。」
    // 判据：正文滚动区的 `<div>` 闭合之后、操作栏的分割线之前，不得再出现任何 `<div>` ——
    // 一旦夹进去东西（哪怕只有一个「编辑于」留白行），正文滚到底就会停在那东西上方，
    // 中间重新出现一块够不着的死区。
    // 证据：Temp/qo-keyboard-probe/view-bottom.mjs（旧 gap=61px / 新 gap=0px）。
    const bodyAt = indexOrFail(BODY)
    const range = divRange(src, bodyAt)
    expect(range, '正文滚动区的 <div> 没配平 —— 解析失败，后面的断言会空转').not.toBeNull()
    const divider = indexOrFail(BAR)
    expect(divider, '操作栏跑到正文滚动区前面去了').toBeGreaterThan(range![1])
    // ⚠️ 切片必须切到操作栏**自己的 `<div` 起始标签之前**：BAR 锚点落在它的 className 里，
    //    直接用 divider 当右界会把操作栏的开标签也圈进来（踩过，F8 因此假红）。
    const barTagAt = src.lastIndexOf('<div', divider)
    expect(barTagAt, '找不到操作栏的 <div> 起始标签').toBeGreaterThan(range![1])
    expect(
      src.slice(range![1], barTagAt),
      '正文滚动区与操作栏之间又夹了元素 ⇒ 正文滚到底也够不到分割线，中间会空出一块',
    ).not.toMatch(/<\/?div/)
  })
})
