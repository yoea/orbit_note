// 守卫：查看页底部的「内容尾行」与「操作栏」分工。
//
// 背景（2026-09-30 用户反馈）：正文最后一行与分割线贴得太近、显得拥挤。根因不是
// 「分割线太靠上」，而是**中间本来就没有东西**：
//   · Markdown.tsx 的段落是 `mb-3 last:mb-0` ⇒ 末段没有下边距；
//   · 分割线是下方 footer 的 `border-t`，紧贴其后 ⇒ 两者之间 0px；
//   · footer 的 `py-4` 在分割线**内侧**，只决定「图标离分割线多远」，松开正文要靠
//     分割线**上方**的元素。
// 于是新增「内容尾行」：既承担留白（pt-8 / pb-4），又承载这一篇自己的状态
// （打开次数、编辑时间）。语义分工：
//   内容尾行 = 「这篇内容的状态」；下面的操作栏 = 「对这个页面的操作」。
// 将来的「单篇分享」入口也加在尾行，与打开次数同组。
//
// 判定一律先断言下标 >= 0 再比大小：`indexOf` 未命中返回 -1，而 `-1 < 正数` 恒真，
// 不做这一步的话「目标被删掉」时断言反而会通过。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classAttrsIn, classTokens, projectRoot, stripComments } from './class-attrs'

const FILE = 'components/EntryView.tsx'
const src = stripComments(readFileSync(join(projectRoot, FILE), 'utf8'))
const attrs = classAttrsIn(FILE, src)

function indexOrFail(needle: string): number {
  const i = src.indexOf(needle)
  expect(i, `${FILE} 里找不到「${needle}」，后面的比较会空转`).toBeGreaterThanOrEqual(0)
  return i
}

describe('F · 查看页内容尾行与操作栏', () => {
  it('F0 解析自检：锚点齐全（防断言空转）', () => {
    expect(src.length).toBeGreaterThan(2000)
    for (const needle of ['MarkdownBoundary', '编辑于', '打开过', 'border-t', '-mr-2', 'fmtDate']) {
      expect(src, `找不到锚点「${needle}」`).toContain(needle)
    }
    expect(attrs.length, '没能解析出任何 class 属性').toBeGreaterThan(10)
  })

  it('F1 「编辑于」在分割线**上方**（不能再退回操作栏左侧）', () => {
    const edited = indexOrFail('编辑于')
    const divider = indexOrFail('border-t')
    expect(
      edited,
      '「编辑于」又跑到分割线下面去了 —— 它就变成操作栏的一部分，尾行空掉之后正文还是贴着分割线',
    ).toBeLessThan(divider)
  })

  it('F2 尾行在正文之后、分割线之前，且自带留白', () => {
    const body = indexOrFail('MarkdownBoundary')
    const tail = src.indexOf('pt-8')
    expect(tail, '找不到尾行的留白类 pt-8，后面的比较会空转').toBeGreaterThanOrEqual(0)
    const divider = indexOrFail('border-t')
    expect(body, '尾行跑到正文前面去了').toBeLessThan(tail)
    expect(tail, '尾行跑到分割线下面去了（那样就起不到松开正文的作用）').toBeLessThan(divider)

    const tailAttrs = attrs.filter((a) => a.text.includes('pt-8'))
    expect(tailAttrs.length, '找不到带 pt-8 的 class 属性').toBeGreaterThan(0)
    const tokens = [...new Set(tailAttrs.flatMap((a) => classTokens(a.text)))]
    expect(tokens, '尾行没有下内边距 —— 那一行会贴着分割线').toContain('pb-4')
    // 分割线只属于操作栏：尾行自己不能画线，否则会出现两条分割线
    expect(tokens.filter((t) => t.startsWith('border-')), '尾行不该有边框').toEqual([])
  })

  it('F3 操作栏是**两组**：左＝收藏、右＝编辑/删除（收藏落最底部，用户指定的位置）', () => {
    const footerAttrs = attrs.filter((a) => a.text.includes('border-t') && a.text.includes('mt-auto'))
    expect(footerAttrs.length, '找不到操作栏的 class 属性（border-t + mt-auto）').toBeGreaterThan(0)
    const tokens = footerAttrs.flatMap((a) => classTokens(a.text))
    // 有了「收藏」这一组之后 justify-between 重新成为必需（左组贴左、右组贴右）；
    // 唯一不能回来的是「用空 span 占位把图标顶到右边」那套写法（见下条）。
    expect(tokens, '操作栏没有两端对齐').toContain('justify-between')
    expect(tokens, 'gap-6 是给「编辑于 ↔ 图标组」拉间距的，收藏与图标组各有自己的内边距').not.toContain('gap-6')
    // 收藏按钮在分割线**下方**、且在编辑/删除那一组的**左边**（源码顺序即视觉顺序）。
    // 锚点用 onClick 而不是 'StarIcon'：后者在 import 里也出现，会命中文件开头（断言空转的反面）。
    const divider = indexOrFail('border-t')
    const star = indexOrFail('() => void toggleStar()')
    const iconGroup = indexOrFail('-mr-2')
    expect(star, '收藏按钮跑到分割线上方去了（那里是内容尾行）').toBeGreaterThan(divider)
    expect(star, '收藏按钮跑到编辑/删除右边去了（它的位置在操作栏最左）').toBeLessThan(iconGroup)
  })

  it('F6 「编辑于」不在操作栏里（它属于内容尾行）', () => {
    const barStart = indexOrFail('mt-auto flex items-center justify-between')
    const bar = src.slice(barStart, src.indexOf('</main>', barStart))
    expect(bar, '「编辑于」又被放回操作栏了——它一回去，内容尾行就又空成一段留白').not.toContain('编辑于')
  })

  it('F4 打开次数是「图标 + 数字」且有可访问标签', () => {
    expect(src, '打开次数没有可读标签（图标 + 裸数字对屏幕阅读器等于噪声）').toContain('打开过')
    expect(src).toContain('role="img"')
    const eye = src.indexOf('viewCount > 0')
    expect(eye, '找不到打开次数图标的渲染条件，后面的比较会空转').toBeGreaterThanOrEqual(0)
    expect(eye, '打开次数渲染在尾行之外').toBeLessThan(indexOrFail('border-t'))
  })

  it('F5 尾行至少承担留白，即使里面没有任何内容', () => {
    // 打开次数与「编辑于」都可能不显示（计数失败 / 从未编辑过），
    // 所以留白必须挂在**容器**上，不能挂在某一个子元素上——否则两者都不显示时又会贴在一起。
    const tailAttrs = attrs.filter((a) => a.text.includes('pt-8'))
    expect(tailAttrs.length).toBeGreaterThan(0)
    for (const a of tailAttrs) {
      expect(a.text, '留白类被放到了条件渲染的子元素上').not.toContain('viewCount')
      expect(a.text, '留白类被放到了条件渲染的子元素上').not.toContain('isEdited')
    }
  })
})
