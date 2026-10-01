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

/** 「编辑于」所在底部行的 class（恒渲染的留白容器） */
const DATE_ROW = 'mt-auto pt-8 pb-3'
/** 操作栏的 class（分割线 + 上下内边距，唯一） */
const BAR = 'border-t border-neutral-100 py-4'

function indexOrFail(needle: string): number {
  const i = src.indexOf(needle)
  expect(i, `${FILE} 里找不到「${needle}」，后面的比较会空转`).toBeGreaterThanOrEqual(0)
  return i
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
    for (const needle of ['MarkdownBoundary', '编辑于', '打开过', DATE_ROW, BAR, '-mr-2', 'fmtDate', 'showViews && (']) {
      expect(src, `找不到锚点「${needle}」`).toContain(needle)
    }
    expect(attrs.length, '没能解析出任何 class 属性').toBeGreaterThan(10)
  })

  it('F1 「编辑于」在分割线**上方**（它被钉在分割线正上方，不属于操作栏）', () => {
    const edited = indexOrFail('编辑于')
    const divider = indexOrFail(BAR)
    expect(edited, '「编辑于」跑到分割线下面去了 —— 它就变成操作栏的一部分了').toBeLessThan(divider)
  })

  it('F2 底部行用 mt-auto 钉住、自带留白，且容器**恒渲染**（只有内容才是条件渲染）', () => {
    const body = indexOrFail('MarkdownBoundary')
    const row = indexOrFail(DATE_ROW)
    const divider = indexOrFail(BAR)
    expect(body, '底部行跑到正文前面去了').toBeLessThan(row)
    expect(row, '底部行跑到分割线下面去了').toBeLessThan(divider)

    const rowAttrs = attrs.filter((a) => a.text.includes(DATE_ROW))
    expect(rowAttrs.length, '找不到底部行的 class 属性').toBe(1)
    const tokens = classTokens(rowAttrs[0].text)
    // mt-auto = 正文短时也不往上浮（用户要求「固定在贴近分割线」）
    expect(tokens, '没有 mt-auto —— 正文短时「编辑于」会浮到正文下面去').toContain('mt-auto')
    // pt-8 = 正文与「编辑于」之间的呼吸空间。★ 没有它，未编辑过的条目正文末行会贴住分割线
    //（Markdown 的末段是 last:mb-0，间隙本来是 0px —— 这正是当初加「内容尾行」的原因）
    expect(tokens, '少了上留白 —— 未编辑过的条目正文末行会贴住分割线').toContain('pt-8')
    // 留白必须挂在**容器**上，不能挂在条件渲染的子元素上（见 F5 的反向断言）
    expect(rowAttrs[0].text, '留白类被放到了条件渲染的子元素上').not.toContain('isEdited')
    // 分割线只属于操作栏：底部行自己不能画线，否则会出现两条分割线
    expect(tokens.filter((t) => t.startsWith('border-')), '底部行不该有边框').toEqual([])
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
})
