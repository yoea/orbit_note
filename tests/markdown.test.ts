import { describe, expect, it } from 'vitest'
import {
  TOOLBAR_ACTIONS,
  countWords,
  deriveTitlePreview,
  toPlainText,
  toggleLinePrefix,
  toggleWrap,
} from '@/lib/client/markdown'

// Markdown 派生层单测。
//
// 重点关注三件事：
//   1. 纯文本提取要把标记剥干净（搜索/列表/字数全部依赖它）；
//   2. **换行语义**必须与渲染侧（remark-breaks：软换行 → <br>）一致——
//      两行之间不能粘成一个词，否则搜「行第」会误命中；
//   3. raw HTML 既不渲染也不进检索（项目零注入面的立场）。
//
// 正则断言统一用信源分隔（两行之间必须有 \n），别放松成「包含」——
// 那会连「粘在一起」这种真实退化一起放过。

describe('toPlainText：标记剥离', () => {
  it('标题剥掉 # 号', () => {
    expect(toPlainText('# 标题')).toBe('标题')
    expect(toPlainText('### 三级标题')).toBe('三级标题')
  })

  it('粗体 / 斜体剥掉标记', () => {
    expect(toPlainText('**粗体** 和 *斜体*')).toBe('粗体 和 斜体')
  })

  it('删除线**不**解析——GFM 未启用，原样保留（有意如此）', () => {
    // 这条是「防误加」断言：`~~` 属于 GFM 扩展，CommonMark 不认。
    // 如果哪天装了 remark-gfm，这里会失败，提醒同时补上渲染侧与工具条。
    // 反过来，若有人只看渲染没看这里就给工具条加了删除线按钮，那按钮只会插入
    // 一段肉眼可见的波浪号——比没有这个按钮更糟。
    expect(toPlainText('~~删掉~~')).toBe('~~删掉~~')
    expect(TOOLBAR_ACTIONS.some((a) => a.marker.includes('~~'))).toBe(false)
  })

  it('行内代码与代码块取原文', () => {
    expect(toPlainText('用 `npm ci` 装依赖')).toBe('用 npm ci 装依赖')
    expect(toPlainText('```\nline1\nline2\n```')).toBe('line1\nline2')
  })

  it('列表剥掉项目符号，项目之间保持换行', () => {
    expect(toPlainText('- 甲\n- 乙')).toBe('甲\n乙')
    expect(toPlainText('1. 甲\n2. 乙')).toBe('甲\n乙')
  })

  it('引用剥掉 > 号', () => {
    expect(toPlainText('> 引用一句')).toBe('引用一句')
  })

  it('链接只留文字，图片退化为 alt', () => {
    expect(toPlainText('[文字](https://example.com)')).toBe('文字')
    expect(toPlainText('![一张图](https://example.com/a.png)')).toBe('一张图')
  })

  it('分割线不产出任何文字', () => {
    expect(toPlainText('---')).toBe('')
  })

  it('空输入与纯空白输入都得到空串', () => {
    expect(toPlainText('')).toBe('')
    expect(toPlainText('   \n\n  ')).toBe('')
  })
})

describe('toPlainText：换行语义（必须与渲染侧 remark-breaks 对齐）', () => {
  it('单换行保留为换行，两行不粘连', () => {
    // 关键回归：若 break 节点被丢弃，这里会得到「第一行第二行」，
    // 于是搜索「行第」会误命中，标题/摘要也会串行。
    const text = toPlainText('第一行\n第二行')
    expect(text).toBe('第一行\n第二行')
    expect(text).not.toContain('行第')
  })

  it('空行分段：段间也是换行，不出现空段', () => {
    expect(toPlainText('第一段\n\n第二段')).toBe('第一段\n第二段')
  })

  it('标题与正文之间保持换行', () => {
    expect(toPlainText('# 我的标题\n\n今天的正文')).toBe('我的标题\n今天的正文')
  })
})

describe('toPlainText：raw HTML 与渲染侧保持一致', () => {
  // 这一组是「一致性」断言，不是「安全」断言。
  // 安全边界在渲染侧：不装 rehype-raw ⇒ HTML 永远进不了 DOM（见 markdown-render.test.ts）。
  // 这里要保证的是：**用户看得见的，就搜得到**。渲染侧会把 raw HTML 转义成可见文本，
  // 派生侧若丢掉它，正文里明明显示着 `<b>加粗</b>`，用户搜 `<b>` 却搜不到。

  it('块级 raw HTML 保留原文（渲染侧也是以文本呈现的）', () => {
    expect(toPlainText('<script>alert(1)</script>')).toBe('<script>alert(1)</script>')
  })

  it('行内 HTML 连标签一起保留，与渲染输出一致', () => {
    expect(toPlainText('正文 <b>加粗</b> 结尾')).toBe('正文 <b>加粗</b> 结尾')
  })
})

describe('countWords', () => {
  it('按纯文本口径计数（标记不计入）', () => {
    expect(countWords('**粗**体')).toBe(2)
    expect(countWords('# 标题')).toBe(2)
    expect(countWords('```\nabc\n```')).toBe(3)
  })

  it('空内容为 0', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('---')).toBe(0)
  })

  it('与改造前口径一致：保留内部空白，只去首尾', () => {
    // 改造前是 plain.trim().length，这里对纯文本沿用同一口径
    expect(countWords('a b')).toBe(3)
  })
})

describe('deriveTitlePreview（输入是纯文本）', () => {
  it('首行非空行作标题，其余作摘要', () => {
    expect(deriveTitlePreview('我的标题\n正文第一行\n正文第二行'))
      .toEqual({ title: '我的标题', preview: '正文第一行\n正文第二行' })
  })

  it('跳过前导空行，并去掉标题两端空白', () => {
    expect(deriveTitlePreview('\n\n   标题   \n后续'))
      .toEqual({ title: '标题', preview: '后续' })
  })

  it('只有标题时摘要为空', () => {
    expect(deriveTitlePreview('只有一行')).toEqual({ title: '只有一行', preview: '' })
  })

  it('空内容返回双空串', () => {
    expect(deriveTitlePreview('')).toEqual({ title: '', preview: '' })
    expect(deriveTitlePreview('   ')).toEqual({ title: '', preview: '' })
  })

  it('与 toPlainText 串联后，Markdown 标题不再带井号', () => {
    expect(deriveTitlePreview(toPlainText('# 我的标题\n\n正文')).title).toBe('我的标题')
  })
})

describe('toggleWrap', () => {
  it('包裹选区并保留选中内容', () => {
    expect(toggleWrap('hello', 0, 5, '**')).toEqual({ text: '**hello**', selStart: 2, selEnd: 7 })
  })

  it('选中的内容自带标记时去掉标记（可连续切换）', () => {
    expect(toggleWrap('**hello**', 0, 9, '**')).toEqual({ text: 'hello', selStart: 0, selEnd: 5 })
  })

  it('标记在选区外侧时去掉标记', () => {
    expect(toggleWrap('**hello**', 2, 7, '**')).toEqual({ text: 'hello', selStart: 0, selEnd: 5 })
  })

  it('空选区时插入一对标记并把光标放到中间', () => {
    expect(toggleWrap('hello', 5, 5, '**')).toEqual({ text: 'hello****', selStart: 7, selEnd: 7 })
  })

  it('越界选区被夹紧，不抛错', () => {
    const r = toggleWrap('abc', 99, 120, '*')
    expect(r.text).toBe('abc**')
  })
})

describe('toggleLinePrefix', () => {
  it('给单行加前缀', () => {
    expect(toggleLinePrefix('abc', 0, 3, '- ')).toEqual({ text: '- abc', selStart: 2, selEnd: 5 })
  })

  it('已有前缀时去掉（切换语义）', () => {
    expect(toggleLinePrefix('- abc', 0, 5, '- ')).toEqual({ text: 'abc', selStart: 0, selEnd: 3 })
  })

  it('多行选区逐行处理，且跳过空行', () => {
    const r = toggleLinePrefix('a\n\nb', 0, 4, '> ')
    expect(r.text).toBe('> a\n\n> b')
  })

  it('部分行已有前缀时视为未应用（全部加上）', () => {
    const r = toggleLinePrefix('- a\nb', 0, 5, '- ')
    expect(r.text).toBe('- - a\n- b')
  })

  it('空内容原样返回，不抛错', () => {
    expect(toggleLinePrefix('', 0, 0, '> ')).toEqual({ text: '', selStart: 0, selEnd: 0 })
  })
})

describe('工具条定义', () => {
  it('每个动作都有唯一 key 与合法 kind', () => {
    const keys = TOOLBAR_ACTIONS.map((a) => a.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const a of TOOLBAR_ACTIONS) {
      expect(['wrap', 'line']).toContain(a.kind)
      expect(a.marker.length).toBeGreaterThan(0)
    }
  })
})
