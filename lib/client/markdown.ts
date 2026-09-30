// Markdown 解析与派生（纯逻辑：无 DOM、无网络、无 React，便于单测）。
//
// 为什么需要这一层：
//   正文现在可以是 Markdown 源码，但项目里有三处功能**假设正文就是纯文本**——
//   搜索匹配（lib/client/search.ts）、列表页的标题与摘要（DiaryListView）、字数统计。
//   如果直接拿源码去参与这三件事，用户搜「粗体」会命中所有 **加粗**，
//   列表会显示「# 标题」的井号和「**粗体**」的星号，字数会把标记符号也算进去。
//   所以统一在这里把源码**派生**成纯文本，上游功能只认纯文本，只有渲染才用源码。
//
// 为什么用 mdast 而不是自己写解析器：
//   CommonMark 规范 600 多页，自己写必然在边界（嵌套、转义、列表续行）上出错。
//   micromark 是 CommonMark 的参考实现，mdast-util-from-markdown 是它的 AST 封装；
//   渲染侧 react-markdown 走的是同一套 remark 管线 ⇒ **两边共用同一份语法认知**，
//   不会出现「渲染成加粗、但搜索按纯文本算时判定不一致」这种漂移。
//
// 换行语义（重要，见 tests/markdown.test.ts 的用例）：
//   本项目选定「单换行 = 硬换行」（GitHub 评论区 / Obsidian 默认行为），由 remark-breaks
//   在渲染侧实现（软换行 → break 节点 → <br>）。这一层必须与之对齐：break 节点产出 '\n'，
//   否则纯文本会把两行粘成一行（搜索 "行第" 会误命中），标题/摘要也会算错。
//   为什么不用「单换行 = 新段落」：老笔记都是「一行一段」写的，那样渲染成标准 Markdown
//   需要把单换行当分段，会破坏列表项与代码块内部结构（续行会被切断）。

import { fromMarkdown } from 'mdast-util-from-markdown'
import type { RootContent } from 'mdast'

/** 块级容器：其子节点之间插入换行；其余（行内节点）直接拼接 */
const BLOCK_CONTAINERS = new Set(['root', 'blockquote', 'list', 'listItem', 'footnoteDefinition'])

/**
 * 取节点可见文本。
 * - text / inlineCode / code：取 value
 * - break：换行（对应渲染侧的 <br>，两边必须一致）
 * - image：退化为 alt（图片本身不外链加载，见 components/Markdown.tsx）
 * - html：**保留原文**。渲染侧（react-markdown 默认不装 rehype-raw）会把 raw HTML
 *   转义成可见文本输出，用户在正文里看得见 `&lt;b&gt;`。派生侧若不保留，
 *   就会出现「看得见却搜不到」——纯文本是搜索/字数/摘要的唯一输入，必须忠实于渲染结果。
 *   安全性不受影响：这里是纯字符串，只参与字符串比较与计数，永远不参与渲染；
 *   真正的边界在渲染侧（HTML 进不了 DOM）。
 */
function nodeText(node: RootContent): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
    case 'code':
    case 'html':
      return node.value
    case 'break':
      return '\n'
    case 'image':
      return node.alt ?? ''
    default: {
      if (!('children' in node)) return ''
      const sep = BLOCK_CONTAINERS.has(node.type) ? '\n' : ''
      return (node.children as RootContent[]).map(nodeText).join(sep)
    }
  }
}

/** 解析为 mdast（调用方需要结构化访问时用；多数场景直接用 toPlainText） */
export function parseMarkdown(src: string) {
  return fromMarkdown(src)
}

/**
 * 源码 → 纯文本。用于搜索、列表标题/摘要、字数统计。
 * 返回值已 trim（列表首行判定与旧口径一致）。
 */
export function toPlainText(src: string): string {
  const root = fromMarkdown(src)
  return root.children.map(nodeText).join('\n').trim()
}

/** 字数：与既有口径一致（trim 后的字符数，含内部空白），只是改为在纯文本上计算 */
export function countWords(src: string): number {
  return toPlainText(src).length
}

export interface TitlePreview {
  title: string
  preview: string
}

/**
 * 列表页的标题与摘要。
 * 算法与改造前逐字一致（「第一个非空行 = 标题，其余 = 摘要」），只是输入换成纯文本——
 * 这样 `# 我的标题` 得到的是「我的标题」而不是「# 我的标题」。
 * 之所以不做「优先取 heading 节点」的语义化版本：现有列表/搜索的相关度权重都以
 * 「首行即标题」为前提，改口径会连带影响排序，不值得。
 *
 * 注意：列表页一次要处理最多 200 条，那里直接用 toPlainText 再本地切分（一次解析），
 * 不要在这里连环调用（会重复解析）。
 */
export function deriveTitlePreview(text: string): TitlePreview {
  const lines = text.split('\n')
  const titleIdx = lines.findIndex((l) => l.trim() !== '')
  if (titleIdx < 0) return { title: '', preview: '' }
  return {
    title: lines[titleIdx].trim(),
    preview: lines.slice(titleIdx + 1).join('\n').trim(),
  }
}

// ---------------------------------------------------------------------------
// 编辑器工具条：对选区做「包裹标记 / 行前缀」变换。
// 全部是纯函数并返回新的选区范围，这样调用方可以精确还原光标位置
// （直接 setState 会丢选区，是这类工具条最常见的体验问题）。
// ---------------------------------------------------------------------------

export interface EditResult {
  text: string
  selStart: number
  selEnd: number
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}

/**
 * 在选区两侧包裹对称标记（`**` 粗体、`*` 斜体、`` ` `` 行内代码）。
 * 三种情形：
 *   1. 选区自身已含标记（选中了 `**粗**` 整个）→ 去掉标记；
 *   2. 选区外侧已有标记（光标选中的正是被标记包住的内容）→ 去掉标记；
 *   3. 其余 → 包裹。空选区时把光标放到两个标记之间，方便直接输入。
 */
export function toggleWrap(text: string, selStart: number, selEnd: number, marker: string): EditResult {
  const s = clamp(selStart, 0, text.length)
  const e = clamp(selEnd, s, text.length)
  const selected = text.slice(s, e)
  const m = marker.length

  // 情形 1：选中的内容自带标记
  if (selected.length >= m * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(m, selected.length - m)
    return { text: text.slice(0, s) + inner + text.slice(e), selStart: s, selEnd: s + inner.length }
  }
  // 情形 2：标记在选区外侧
  if (text.slice(s - m, s) === marker && text.slice(e, e + m) === marker) {
    return {
      text: text.slice(0, s - m) + selected + text.slice(e + m),
      selStart: s - m,
      selEnd: e - m,
    }
  }
  // 情形 3：包裹
  const ins = `${marker}${selected}${marker}`
  return {
    text: text.slice(0, s) + ins + text.slice(e),
    selStart: s + m,
    selEnd: s + m + selected.length,
  }
}

/** 取 [s, e] 覆盖的整行范围（行首到行尾，不含换行符） */
function lineSpan(text: string, s: number, e: number): { from: number; to: number } {
  const from = text.lastIndexOf('\n', Math.max(0, s - 1)) + 1
  const nl = text.indexOf('\n', e)
  return { from, to: nl === -1 ? text.length : nl }
}

/**
 * 给选区覆盖的每一行加/去行首前缀（`# ` 标题、`> ` 引用、`- ` 列表）。
 * 判定：该范围内**所有非空行**都已有前缀 ⇒ 视为「已应用」，此操作变为去除（切换语义）。
 * 空行不加前缀（否则会造出一堆空引用/空列表项）。
 */
export function toggleLinePrefix(text: string, selStart: number, selEnd: number, prefix: string): EditResult {
  const s = clamp(selStart, 0, text.length)
  const e = clamp(selEnd, s, text.length)
  const { from, to } = lineSpan(text, s, e)
  const lines = text.slice(from, to).split('\n')
  const nonEmpty = lines.filter((l) => l.trim() !== '')
  if (nonEmpty.length === 0) return { text, selStart: s, selEnd: e }

  const allPrefixed = nonEmpty.every((l) => l.startsWith(prefix))
  const next = lines.map((l) => {
    if (l.trim() === '') return l
    return allPrefixed ? l.slice(prefix.length) : prefix + l
  })
  const replaced = next.join('\n')
  const delta = replaced.length - (to - from)
  return {
    text: text.slice(0, from) + replaced + text.slice(to),
    // 选区整体跟着前缀增删平移，保证用户可以连续点两次（加粗→取消）而不会错位
    selStart: clamp(s + (allPrefixed ? -prefix.length : prefix.length), from, from + replaced.length),
    selEnd: clamp(e + delta, from, from + replaced.length),
  }
}

/** 工具条按钮定义（放这里而不是组件里：纯数据，便于测试与将来复用） */
export interface ToolbarAction {
  key: string
  label: string
  title: string
  kind: 'wrap' | 'line'
  marker: string
}

// 只放 **CommonMark 语法**的动作。
// 刻意不放删除线（`~~`）：那是 GFM 扩展，不装 remark-gfm 的话它不会被解析成标记，
// 按钮只会插入一段肉眼可见的波浪号——比没有这个按钮更糟。
// 同理不放表格：GFM 表格渲染出来还得单独配一套单元格样式，收益不值这个复杂度。
// 将来要 GFM（删除线 / 表格 / 自动链接），加 remark-gfm 并在这里补上对应动作即可。
export const TOOLBAR_ACTIONS: ToolbarAction[] = [
  { key: 'h2', label: 'H', title: '标题', kind: 'line', marker: '## ' },
  { key: 'bold', label: 'B', title: '加粗', kind: 'wrap', marker: '**' },
  { key: 'italic', label: 'I', title: '斜体', kind: 'wrap', marker: '*' },
  { key: 'quote', label: '❝', title: '引用', kind: 'line', marker: '> ' },
  { key: 'ul', label: '•', title: '列表', kind: 'line', marker: '- ' },
  { key: 'code', label: '</>', title: '行内代码', kind: 'wrap', marker: '`' },
]

// ---------------------------------------------------------------------------
// 预览滚动定位（编辑态 → 预览态的位置同步）
//
// 为什么需要：编辑区是 <textarea> 自己的滚动（scrollTop 在 textarea 上），预览是另一个
// 新挂载的 <div overflow-y-auto>。两个不同节点、没有任何位置传递 ⇒ 新节点 scrollTop = 0，
// 预览必然从文档最顶部开始，而用户的光标可能在最底部。
//
// 为什么按「行号」而不是「字符比例」或「第几个块」：
//   - 字符比例：标题 / 代码块的高度与字符数不成比例，累积误差会偏出好几屏；
//   - 第几个块：raw HTML 块在渲染侧被转义成**裸文本节点**（不是元素），
//     DOM 的 children 序号会与源码块序号错位 ⇒ 越往后越偏。
//   行号是两侧都稳定的键（渲染侧由 remark 插件把源码行号写到 data-qo-line）。
// ---------------------------------------------------------------------------

/**
 * 光标在源码中的偏移 → 行号（1-based）。
 * 越界偏移按边界钳制（光标在 0 或末尾时都要给出正确答案——这是「边界情况」的主要来源）。
 */
export function lineAtOffset(src: string, offset: number): number {
  const end = Math.max(0, Math.min(offset, src.length))
  let line = 1
  for (let i = 0; i < end; i++) {
    if (src.charCodeAt(i) === 10) line++
  }
  return line
}

/**
 * 从「块起始行 → 距内容顶部偏移」列表里挑出滚动目标，返回应设置的 scrollTop。
 *
 * - 取起始行 ≤ targetLine 的**最后一个**块：它是包含光标的那一块，
 *   或光标在某块内部的空行上时紧邻其上方的块（这两种都该把该块顶到视口顶部）。
 * - 所有块都晚于 targetLine（光标在第一个块之前）→ 返回第一块的偏移。
 * - 列表为空（空文档 / 预览显示占位文案）→ 返回 0。
 *
 * blocks 必须按源码顺序（= DOM 顺序）给出，函数不回退排序：
 * 顺序错说明调用方取错了元素，静默排序会把这种 bug 藏起来。
 */
export function pickScrollTop(blocks: { line: number; top: number }[], targetLine: number): number {
  if (blocks.length === 0) return 0
  let pick = blocks[0]
  for (const b of blocks) {
    if (b.line <= targetLine) pick = b
    else break
  }
  return pick.top
}
