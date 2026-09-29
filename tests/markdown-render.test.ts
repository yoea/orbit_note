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
