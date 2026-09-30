import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from '@/components/Markdown'
import { toPlainText } from '@/lib/client/markdown'

// 渲染层冒烟测试（不需要浏览器：react-dom/server 把组件渲成静态 HTML 字符串，
// 我们断言的是「产出里有没有该有的元素、有没有不该有的东西」）。
//
// 为什么必须有这个文件：
//   渲染引入了一个新的第三方依赖（react-markdown）。它的行为里有几条是本项目的安全前提，
//   一旦某次升级改了默认值，光看源码是发现不了的——必须用断言把它们钉住：
//     1. raw HTML **不渲染**（不装 rehype-raw 就拿不到注入面）；
//     2. 图片**不产出 <img>**（外链图片会把「我在看什么」泄露给第三方图床）；
//     3. 外链带 noopener / noreferrer，且危险协议被清掉；
//     4. 单换行渲染成 <br>（remark-breaks 生效）——否则老笔记会被挤成一整段。
//   注意：产物里出现 dangerouslySetInnerHTML 字面量并不等于我们用了它
//   （Next 框架内部与 React DOM 自身都带这个属性名），所以判据只能是「行为」而不是「grep」。

function html(source: string): string {
  return renderToStaticMarkup(createElement(Markdown, { source }))
}

describe('Markdown 渲染：基础语法', () => {
  it('粗体 / 斜体产出语义标签', () => {
    expect(html('**粗**')).toContain('<strong')
    expect(html('**粗**')).toContain('粗')
    expect(html('*斜*')).toContain('<em')
    expect(html('*斜*')).toContain('斜')
  })

  it('标题与列表产出对应标签', () => {
    expect(html('# 大标题')).toContain('<h1')
    expect(html('- 甲\n- 乙')).toContain('<ul')
    expect(html('- 甲\n- 乙')).toContain('<li')
  })

  it('单换行渲染成 <br>（与 toPlainText 的换行语义对齐）', () => {
    const out = html('第一行\n第二行')
    expect(out).toContain('<br')
    // 只有一次段落包裹：两行属于同一个段落，靠 <br> 分行
    expect(out.match(/<p/g)?.length).toBe(1)
  })

  it('空行分段：两段之间是两个 <p>', () => {
    expect(html('第一段\n\n第二段').match(/<p/g)?.length).toBe(2)
  })
})

describe('Markdown 渲染：换行与段间距（每个换行恰好一行）', () => {
  // 真实事故（2026-09-30，用户反馈「查看页段间距过大，像凭空多出一个空行」）：
  // mdast-util-to-hast 的 break 处理器会在**每个 <br> 之后又补一个值为 "\n" 的文本节点**
  // （见 node_modules/mdast-util-to-hast/lib/handlers/break.js 的
  //  `[state.applyData(node, result), { type: 'text', value: '\n' }]`）。
  // 它本来是给「序列化成 HTML 字符串」看的（HTML 默认折叠空白，谁也看不见），
  // 但只要段落带了 whitespace-pre-wrap，这个 "\n" 就会被原样渲染成**第二次换行**：
  // 用户敲一个回车，编辑页是一行、查看页变成两行（中间白出一整行）。
  // 换行语义本来就由 remark-breaks 全权负责（\n → <br>），CSS 侧不需要也不该再保留空白。
  it('段落不得使用 whitespace-pre*（否则 <br> 后面那个 "\\n" 会变成第二次换行）', () => {
    const out = html('第一行\n第二行')
    expect(out, 'remark-breaks 没生效，本守卫的前提不成立').toContain('<br')
    const pOpen = out.match(/<p[^>]*>/)?.[0] ?? ''
    expect(pOpen, '解析不到段落开始标签，这条断言会空转').toMatch(/^<p[\s>]/)
    expect(
      pOpen,
      '段落带了 whitespace-pre* ⇒ 每个换行会被渲染成两个空行（编辑页一行、查看页两行）',
    ).not.toMatch(/whitespace-pre/)
  })

  it('整篇渲染产物里不存在任何保留空白的块（含列表 / 引用 / 代码块）', () => {
    const out = html('# 标题\n\n段落一\n第二行\n\n- 甲\n- 乙\n\n> 引用\n\n```js\nconst a = 1\n```\n')
    expect(out, '渲染产物为空，断言会空转').toContain('<br')
    for (const tag of out.match(/<[a-z][a-z0-9]*[^>]*>/g) ?? []) {
      expect(tag, `产物里出现了 whitespace-pre*：${tag}`).not.toMatch(/whitespace-pre/)
    }
  })
})

describe('Markdown 渲染：安全前提（升级依赖后必须仍然成立）', () => {
  it('块级 raw HTML 不产生元素，只以转义文本呈现', () => {
    const out = html('<script>alert(1)</script>')
    expect(out).not.toContain('<script')
    expect(out).toContain('&lt;script&gt;')
  })

  it('行内 HTML 同样只以转义文本呈现', () => {
    const out = html('正文 <b>加粗</b> 结尾')
    expect(out).not.toContain('<b>')
    expect(out).toContain('&lt;b&gt;')
    expect(out).toContain('加粗')
  })

  it('派生纯文本与渲染结果一致：看得见就该搜得到', () => {
    // 这是 toPlainText 与渲染器之间唯一必须成立的不变量。
    // 渲染侧把标签转义成可见文本 ⇒ 派生侧也必须保留，否则搜索会漏。
    const src = '正文 <b>加粗</b> 结尾'
    expect(toPlainText(src)).toBe('正文 <b>加粗</b> 结尾')
    expect(html(src)).toContain('&lt;b&gt;加粗&lt;/b&gt;')
  })

  it('图片不产出 <img>（不触发任何外链请求）', () => {
    const out = html('![一张图](https://example.com/a.png)')
    expect(out).not.toContain('<img')
    expect(out).toContain('一张图')
  })

  it('外链带 target=_blank 与 noopener noreferrer', () => {
    const out = html('[链接](https://example.com)')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it('危险协议（javascript:）被清掉', () => {
    const out = html('[点我](javascript:foo)')
    expect(out).not.toContain('javascript:')
  })
})
