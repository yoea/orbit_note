// 样式守卫测试共用的源码解析工具。
//
// 为什么需要它：项目里有两类「配色/留白」回归守卫，它们都要回答同一个问题——
// 「某个 class 到底有没有真的用到 JSX 上」。用 grep 直接搜字符串会踩三个坑：
//   1. 注释里为了说明问题会引用被禁的写法（文档不是用法）；
//   2. className 可以跨多行、可以嵌在模板字符串里（`${cond ? 'a' : 'b'}`）；
//   3. 变体前缀（dark: / placeholder: / hover:）会让「连写匹配」失效。
// 这里按「属性边界」抽取 + 剥离注释，再交给各守卫按 token 判定。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = fileURLToPath(new URL('..', import.meta.url))

export function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectSourceFiles(full))
    else if (/\.(tsx|ts|css)$/.test(entry.name)) out.push(full)
  }
  return out
}

// 去掉注释，避免文档里引用的示例写法被当成真实用法
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

// 从 idx（className/class 关键字位置）读一个属性值，支持 "..." / '...' / {...}
// （含模板字符串、嵌套花括号、字符串里的转义）
function readAttr(src: string, idx: number): { text: string; end: number } {
  let i = idx
  while (i < src.length && src[i] !== '=') i++
  i++
  while (i < src.length && /\s/.test(src[i])) i++
  if (src[i] === '"' || src[i] === "'") {
    const quote = src[i]
    i++
    while (i < src.length && src[i] !== quote) i++
    return { text: src.slice(idx, i + 1), end: i + 1 }
  }
  if (src[i] === '{') {
    const start = i
    let depth = 0
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') {
        depth--
        if (depth === 0) { i++; break }
      } else if (src[i] === '"' || src[i] === "'") {
        const quote = src[i]
        i++
        while (i < src.length && src[i] !== quote) { if (src[i] === '\\') i++; i++ }
      }
    }
    return { text: src.slice(start, i), end: i }
  }
  return { text: '', end: idx + 1 }
}

// lib/client/ui.ts 里导出的 class 常量表（`export const XXX_CLASS = '…'`）。
//
// 为什么解析阶段就要展开：组件把样式收敛成常量之后，className 属性原文里只剩
// `{DIALOG_FOOTER_BUTTON_CLASS}` 这样的标识符——不展开的话，所有「按 token 找 py-3.5」
// 「不许出现 p-3」的断言都会**静默空转**（查不到就当作没有违规），比断言失败危险得多。
// 2026-09-30 实测踩到：弹窗底部按钮改用共享常量后，safe-area-padding 的 G4 立刻变红，
// 而 dialog-footer 的「不许 p-3」那条反倒更"稳"了（空转）。
//
// 这里**自动扫常量表**而不是硬编码常量名：将来往 ui.ts 里加新常量无需回来改这个文件。
function classConstantTable(): Record<string, string> {
  const src = readFileSync(join(projectRoot, 'lib/client/ui.ts'), 'utf8')
  const table: Record<string, string> = {}
  for (const m of src.matchAll(/export const (\w+)\s*=\s*'([^']*)'/g)) table[m[1]] = m[2]
  return table
}
const CLASS_CONSTANTS = classConstantTable()

/** 把 className 属性原文里的 class 常量名展开成真实 class 串 */
export function expandClassConstants(text: string): string {
  let out = text
  for (const [name, value] of Object.entries(CLASS_CONSTANTS)) out = out.replaceAll(name, value)
  return out
}

export interface ClassAttr {
  /** 属性原文（可能跨多行、含模板字符串表达式）；**class 常量已展开成真实 class 串** */
  text: string
  /** className 关键字所在行号（1-based） */
  line: number
  /** 相对仓库根的文件路径 */
  file: string
}

export function classAttrsIn(relFile: string, src: string): ClassAttr[] {
  // 统一成 POSIX 分隔符：Windows 上 path.join 产出的是 "app\login\page.tsx"，
  // 而守卫测试里写的是 "app/login/page.tsx"。不归一化的话按文件名查 token 会永远查不到，
  // 断言就变成**空转通过**——比失败更危险。
  const rel = relFile.replace(/\\/g, '/')
  const out: ClassAttr[] = []
  for (const needle of ['className', 'class']) {
    let idx = 0
    while ((idx = src.indexOf(needle, idx)) !== -1) {
      // 避免 'class' 命中 'className' 造成重复
      if (needle === 'class' && src.startsWith('className', idx)) { idx += 9; continue }
      // 避免命中 getClassName 之类的标识符
      const before = src[idx - 1]
      if (before && /[\w$]/.test(before)) { idx += needle.length; continue }
      const { text, end } = readAttr(src, idx)
      if (text) out.push({ text: expandClassConstants(text), line: src.slice(0, idx).split('\n').length, file: rel })
      idx = end
    }
  }
  return out
}

/** 抽取 app/ 与 components/ 下所有已剥离注释的 class 属性 */
export function projectClassAttrs(): ClassAttr[] {
  return [...collectSourceFiles(join(projectRoot, 'app')), ...collectSourceFiles(join(projectRoot, 'components'))]
    .flatMap((f) => classAttrsIn(f.slice(projectRoot.length), stripComments(readFileSync(f, 'utf8'))))
}

/** 把一个 class 属性原文切成独立 token（按空白/引号/花括号/括号切分） */
export function classTokens(attr: string): string[] {
  return attr.split(/[\s"'`{}()]+/).filter((t) => t.length > 0)
}
