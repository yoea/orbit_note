import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { join } from 'node:path'
import Markdown from '@/components/Markdown'
import { classTokens, projectRoot } from './class-attrs'

// ============================================================================
// 段间距守卫（2026-10-06，用户反馈「行间距与段间距视觉上几乎一致，段落难以区分」）
//
// 背景：正文 16px / leading-relaxed（行盒 26px）。
//   · 原来段落下边距 12px（mb-3）⇒ 段间空隙 = 行距的 1.46 倍 —— 与行距差别太小；
//   · 单换行（remark-breaks 的 <br>）**根本没有额外间距** ⇒ 「一行一段」写法的日记里
//     每一行的间隔完全等于行距，段落无从分辨。
//
// ★ 两轮定稿（同一天，用户第二次反馈直接给了目标倍数）：
//   第一版 mb-5（20px，1.77×）—— 用户：「段间距太大了，1.15 倍即可。」
//   定稿 mb-1（4px）⇒ 段间空隙 = 26 + 4 = 30px = 行距的 **1.15 倍**。
//   别自己放大：1.15 是「能看出分段、又不把正文拆散」的那一档。
//
// 现在的规则（两处必须一起成立，缺一条用户就还会看到「分不清段落」）：
//   A. 块级元素下边距 4px（mb-1）；
//   B. 一个硬换行也补 4px ⇒ 「一个回车 == 一个段落」，与 A 的视觉重量一致。
//
// ★ B 为什么要多渲染一个元素而不是给 <br> 写样式：<br> 在 Blink/WebKit 里是专用的换行
//   布局对象，display / height / margin / line-height 全部被忽略（四种写法实测段落高度
//   一模一样，见 Temp/qo-spacing-probe）。所以间距只能由我们自己的元素承担。
// ============================================================================

const MD = 'components/Markdown.tsx'
const CSS = 'app/globals.css'

function read(rel: string): string {
  return readFileSync(join(projectRoot, rel), 'utf8')
}

/** 剥注释后再断言：本文件与源码里的说明都含 mb-3 / 1.25rem 字样，不剥会自己把自己判红 */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*(?:\/\/|\*).*$/gm, '')
}

function html(source: string): string {
  return renderToStaticMarkup(createElement(Markdown, { source }))
}

// 五个块级元素在 Markdown.tsx 里的 className（模板字符串形式，按元素取避免串台）
const BLOCKS: Array<[string, RegExp]> = [
  ['p（段落）', /<p\s+className="([^"]+)"/],
  ['ul（无序列表）', /<ul\s+className="([^"]+)"/],
  ['ol（有序列表）', /<ol\s+className="([^"]+)"/],
  ['blockquote（引用）', /<blockquote\s+className="([^"]+)"/],
  ['pre（代码块）', /<pre\s+className="([^"]+)"/],
]

describe('P · 段间距', () => {
  const src = code(MD)

  it('P0 自检：五个块级元素的 className 都能解析出来（否则后面全是空转）', () => {
    for (const [name, re] of BLOCKS) {
      expect(src.match(re)?.[1], `解析不到 ${name} 的 className —— 断言会空转`).toBeTruthy()
    }
  })

  it('P1 五个块级元素的下边距统一为 mb-1（4px，段间 = 1.15× 行距），不留旧值孤例', () => {
    for (const [name, re] of BLOCKS) {
      const cls = src.match(re)![1] as string
      const tokens = classTokens(cls)
      expect(tokens, `${name} 缺少 mb-1 —— 用户已把段间距定为 1.15 倍行距（4px）`).toContain('mb-1')
      for (const old of ['mb-3', 'mb-5']) {
        expect(tokens, `${name} 又出现了旧值 ${old}（段间距会与其它块不一致）`).not.toContain(old)
      }
    }
  })

  it('P2 硬换行补间距：<br> 保留，且每个换行恰好配一个 qo-br-gap（不多不少）', () => {
    const out = html('第一行\n第二行\n第三行')
    // <br> 必须保留：老笔记「一行一段」全靠它才没被挤成一整段
    expect(out, 'remark-breaks 失效了？<br> 不见了').toContain('<br')
    expect(out.match(/<br/g)?.length, '换行数不对').toBe(2)
    // ★ 一个换行配一个间距块。多于换行数 = 又回到了「一个回车两个空行」（2026-09-30 事故）
    expect(out.match(/qo-br-gap/g)?.length, '换行与间距块数量不一致 —— 要么没间距、要么重复占位').toBe(2)
    // 仍然只有一个段落容器（换行不该把段落拆成两个 <p>）
    expect(out.match(/<p/g)?.length, '换行把段落拆开了，段间距语义会翻倍').toBe(1)
  })

  it('P3 间距块由 CSS 给高度，且高度与块级下边距（mb-1 = 0.25rem）严格相等', () => {
    const css = code(CSS)
    const rule = css.match(/\.qo-markdown\s+\.qo-br-gap\s*\{([^}]*)\}/)
    expect(rule, 'globals.css 里找不到 .qo-markdown .qo-br-gap 规则').toBeTruthy()
    const body = rule![1] as string
    expect(body, '间距块必须自成一行（block），否则加不出垂直间距').toMatch(/display:\s*block/)
    expect(
      body,
      '间距块高度必须与 mb-1（0.25rem）一致：一个回车与一个空行读起来要是同一种分隔',
    ).toMatch(/height:\s*0\.25rem/)
  })

  it('P4 不得把 <br> 后那个 "\\n" 变成第二个行盒（whitespace-pre 会，2026-09-30 事故）', () => {
    const out = html('第一行\n第二行')
    const pOpen = out.match(/<p[^>]*>/)?.[0] ?? ''
    expect(pOpen, '解析不到段落开始标签，断言会空转').toMatch(/^<p[\s>]/)
    expect(pOpen).not.toMatch(/whitespace-pre/)
  })
})
