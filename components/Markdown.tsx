'use client'

import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'

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

export default function Markdown({ source, className = '' }: { source: string; className?: string }) {
  return (
    <div className={`qo-markdown text-base leading-relaxed text-neutral-800 dark:text-neutral-200 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkBreaks]}
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
          p: ({ children }) => <p className="mb-3 whitespace-pre-wrap last:mb-0">{children}</p>,
          h1: ({ children }) => <h1 className="mb-2 mt-4 text-lg font-semibold first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-base font-medium first:mt-0">{children}</h3>,
          ul: ({ children }) => <ul className="mb-3 list-disc pl-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal pl-5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="mb-1 last:mb-0">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 border-neutral-200 pl-3 text-neutral-500 last:mb-0 dark:border-neutral-700 dark:text-neutral-400">
              {children}
            </blockquote>
          ),
          code: ({ children }) => <code className={INLINE_CODE_CLASS}>{children}</code>,
          pre: ({ children }) => (
            <pre className="mb-3 overflow-x-auto rounded-xl bg-neutral-50 p-3 text-sm last:mb-0 dark:bg-neutral-900">
              {children}
            </pre>
          ),
          hr: () => <hr className="my-4 border-neutral-200 dark:border-neutral-800" />,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
