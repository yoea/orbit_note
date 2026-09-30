'use client'

import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import type { Root } from 'mdast'

// Markdown 渲染（查看态与编辑器预览共用）。
//
// 为什么不自己写渲染器、也不写 HTML 字符串：
//   项目铁律是**零 dangerouslySetInnerHTML**（XSS 防护靠 React 文本渲染，配合严格 CSP）。
//   react-markdown 把 AST 直接渲染成 React 元素，不经过 HTML 字符串，
//   因此这条铁律是「由构造保证」的，而不是靠我们每次记得转义。
//   另外它**默认忽略 raw HTML**（`<script>` 之类原样丢弃，不渲染、不执行）——
//   我们不再额外引 rehype-raw，就永远拿不到注入面。
//
// 换行语义：remark-breaks 让「单换行」变成硬换行（<br>），与
//   lib/client/markdown.ts 的 toPlainText（break 节点 → '\n'）严格对齐。
//   不装这个插件的话，单换行会退化成软换行（渲染时被当空格），
//   老笔记「一行一段」的写法会被挤成一整段。
//
// 图片：**故意不渲染 <img>**。渲染外链图片等于把「我在看什么、什么时间看」这个信号
//   送给第三方图床，与本项目的隐私立场冲突。这里只显示一个占位标记，
//   等将来做「图片附件」（客户端加密 + 本地 blob）时再换成真实渲染。

const INLINE_CODE_CLASS =
  'rounded bg-neutral-100 px-1.5 py-0.5 text-[0.95em] dark:bg-neutral-800'
const LINK_CLASS = 'text-blue-600 underline underline-offset-2 dark:text-blue-400'

// 给每个**顶层块**打上源码起始行号（data-qo-line）。
//
// 用途只有一个：编辑器从「编辑」切到「预览」时，用光标所在行号找到预览里的对应块，
// 把滚动位置同步过去（见 lib/client/markdown.ts 的 pickScrollTop 与
// lib/client/use-markdown-editor.ts 的 pendingPreviewLineRef）。不这么做的话预览是新挂载的
// 容器、scrollTop 恒为 0，光标在文末也会从顶部开始显示。
//
// 为什么用行号而不是块序号：raw HTML 块在渲染侧被转义成**裸文本节点**（不是元素），
// 用「第几个块」会在含 HTML 的文档里与 DOM children 错位；行号找不到就自然回退到上一块。
//
// ★ 注入只到这里为止：属性由 react-markdown 作为 props 交给自定义组件，**必须由组件
//   自己透传下去**（见 hastAttrs）。漏透传不会报错、页面看起来也完全正常，
//   但定位锚点会一个都不剩——见 hastAttrs 的注释。
function remarkSourceLines() {
  return (tree: Root) => {
    for (const node of tree.children) {
      const line = node.position?.start.line
      if (line == null) continue
      node.data = node.data ?? {}
      const props = (node.data.hProperties ?? {}) as Record<string, string>
      props['data-qo-line'] = String(line)
      node.data.hProperties = props
    }
  }
}

/**
 * 把 react-markdown 交给自定义组件的 hast 属性透传到真实元素上。
 *
 * 为什么必须有这一层：react-markdown 只在**用它的默认渲染**时才把节点属性落到 DOM 上；
 * 一旦我们用 components 接管了某个标签，属性就只送到我们的组件为止，没人会替我们落地。
 * 而本项目注入的 data-qo-line 恰好全部落在被接管的标签上——漏透传的后果不是
 * 「少一个 data 属性」这么轻：
 *   querySelectorAll('[data-qo-line]') 一个元素都取不到 ⇒ pickScrollTop 收到空列表
 *   ⇒ 预览永远从顶部开始，也就是「预览滚动跟随光标」这个功能整体失效。
 * 2026-09-30 实测踩到（rc5 上线后用户反馈「预览滚动还是不对」），
 * tests/markdown-layout.test.ts 的 S2 用**真实渲染产物**钉住它。
 *
 * 为什么是「只放 data-*」的白名单，而不是整体 spread（或剔除 node 后全放）：
 *   - node 是 hast 节点对象，直传会被 React 序列化成 node="[object Object]" 打到真实元素上；
 *   - hast 会带出 className / src / href 之类的原始属性，而我们有两条刻意的例外：
 *     img **故意不渲染 <img>**（只出占位文案，透传 src 等于把外链地址写进 DOM），
 *     code 的 className 是语言标记，透传会盖掉行内代码自己的样式；
 *   - 白名单让「透传」在任何组件上都不会改变既有渲染结果，只剩我们要的行号锚点。
 *     将来要放别的属性（比如标题锚点 id）时，在这里显式加白名单即可。
 */
function dataAttrs(props: object): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(props)) {
    if (!key.startsWith('data-')) continue
    if (typeof value === 'string') out[key] = value
  }
  return out
}

// break-words（overflow-wrap: break-word）必须留在容器上，靠继承覆盖所有后代文本。
//
// 修的是一个真实 bug：正文里贴一段长网址时，那一整串 ASCII 在 CSS 默认规则下**没有任何
// 断点**，会撑破容器；而 (app) 页面的滚动容器是 `overflow-y-auto`（CSS 规定：overflow-y 非
// visible 时 overflow-x 计算为 auto）⇒ 整个页面出现横向滚动条。
// 中文本身可以在任意字间断行，所以这个问题只在「连续无空格的西文/数字串」上出现——
// 也就是长网址、长英文串、base64、连续标点。
//
// 注意断行策略：容器用 break-words 而**不是 break-all**。break-all 会在任意位置硬断，
// 把正常英文单词也从中间切开；break-word 只在「整行放不下这一整串」时才断，是我们要的语义。
// 代码块（pre）反过来要保留原样换行 + 自己的横向滚动，所以在那里把继承下来的
// overflow-wrap 重置回 normal（见下面的 pre 组件）。
//
// 不额外加 `overflow-x-hidden` 兜底：那会把「还有别的东西撑破容器」这类问题一并藏起来。
// 根因修掉即可——tests/markdown-wrap.test.ts 会守住这一条。
export default function Markdown({ source, className = '' }: { source: string; className?: string }) {
  return (
    <div className={`qo-markdown text-base leading-relaxed text-neutral-800 dark:text-neutral-200 break-words ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkBreaks, remarkSourceLines]}
        components={{
          // 外链一律新窗口打开；noopener 防目标页通过 window.opener 反向操作本页。
          // URL 协议由 react-markdown 的默认 urlTransform 过滤（javascript: 等会被清空）。
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
              {children}
            </a>
          ),
          img: ({ alt }) => (
            <span className="text-neutral-500 dark:text-neutral-400">［图片：{alt || '未命名'}］</span>
          ),
          // 下面这些组件都必须把行号锚点透传出去（见 dataAttrs 注释）。锚点会落在：
          // 块级标签本身（p / h1-h3 / ul / ol / blockquote / hr）与**围栏代码块的内层 <code>**
          // ——mdast-util-to-hast 把 hProperties 应用在 code 上而不是外层 pre（实测）。
          // li / a / strong / em 是行内或必然嵌套的元素，拿不到顶层锚点，透传只是顺带。
          p: ({ children, ...rest }) => <p className="mb-3 whitespace-pre-wrap last:mb-0" {...dataAttrs(rest)}>{children}</p>,
          // 标题阶梯：24 / 20 / 18，正文是 16（外层容器的 text-base）。
          //
          // 改造前是 18 / 16 / 16 —— h2 与 h3 字号**完全相同**，只差一个字重级别；
          // 而 h3 又和正文同为 16px（仅 500 vs 400），等于三级标题实际只有两级。
          // 现在三级全部高于正文且逐级递减，层级由「字号」独立承担，字重统一为 600
          // （原先 h3 是 500，与 h2 的字重差让层级更糊）。
          //
          // 为什么 h1 取 24：正文基准 16，24 是 1.5 倍，正好是 Obsidian（1.6em）与
          // GitHub（2em）之间偏克制的一档；在 375px 宽的手机上每行仍能放下 14 个汉字。
          //
          // leading-snug：容器是 leading-relaxed（1.625），对大字号标题太松——
          // 24px × 1.625 = 39px 行高会把标题和它下面的内容推开，削弱"标题属于下方内容"的视觉归属。
          //
          // mt 逐级递减（28/24/20）、mb 也递减（10/8/6）且**都小于段落的 mb-3(12px)**：
          // 标题与上方内容留得多、与自己下方的内容贴得近，这是标题的常规排版逻辑。
          // mb 在 2026-09-30 从 12/10/8 收到 10/8/6：实测标题下方留白偏松，且三级都收紧
          // 相同的 2px，保持原有阶梯比例不变（不是只改某一级）。
          h1: ({ children, ...rest }) => <h1 className="mb-2.5 mt-7 text-2xl font-semibold leading-snug first:mt-0" {...dataAttrs(rest)}>{children}</h1>,
          h2: ({ children, ...rest }) => <h2 className="mb-2 mt-6 text-xl font-semibold leading-snug first:mt-0" {...dataAttrs(rest)}>{children}</h2>,
          h3: ({ children, ...rest }) => <h3 className="mb-1.5 mt-5 text-lg font-semibold leading-snug first:mt-0" {...dataAttrs(rest)}>{children}</h3>,
          ul: ({ children, ...rest }) => <ul className="mb-3 list-disc pl-5 last:mb-0" {...dataAttrs(rest)}>{children}</ul>,
          ol: ({ children, ...rest }) => <ol className="mb-3 list-decimal pl-5 last:mb-0" {...dataAttrs(rest)}>{children}</ol>,
          li: ({ children, ...rest }) => <li className="mb-1 last:mb-0" {...dataAttrs(rest)}>{children}</li>,
          blockquote: ({ children, ...rest }) => (
            <blockquote className="mb-3 border-l-2 border-neutral-200 pl-3 text-neutral-500 last:mb-0 dark:border-neutral-700 dark:text-neutral-400" {...dataAttrs(rest)}>
              {children}
            </blockquote>
          ),
          // 行内代码与围栏代码块的**内层** code 共用这个组件：行号锚点落在围栏代码块的
          // 内层 code 上，所以要透传；className 不在白名单里，语言标记不会盖掉这里的样式。
          code: ({ children, ...rest }) => <code className={INLINE_CODE_CLASS} {...dataAttrs(rest)}>{children}</code>,
          // break-normal：把容器上继承下来的 overflow-wrap 重置回 normal。
          // 代码块要保留源码原样换行 + 自己的横向滚动（overflow-x-auto），不能被强制断行。
          pre: ({ children, ...rest }) => (
            <pre className="mb-3 overflow-x-auto rounded-xl bg-neutral-50 p-3 text-sm last:mb-0 break-normal dark:bg-neutral-900" {...dataAttrs(rest)}>
              {children}
            </pre>
          ),
          hr: (props) => <hr className="my-4 border-neutral-200 dark:border-neutral-800" {...dataAttrs(props)} />,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
