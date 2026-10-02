import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot, classTokens, stripComments } from './class-attrs'

// ============================================================================
// 关于弹窗：结构约定（2026-10-02 用户两轮要求）
//
//   第一轮：① 「版本号移到底部与版权、开源说明同一行」② 精简第三方说明 ③ 收紧间距
//   第二轮：① 「GitHub·版本 应该保持是一个可点击胶囊，让它显眼」
//           ② 三个核心优势图标换色 ③ 整体更美观
//
// 可断言的是结构与配色的**语义**（谁和谁在同一行、胶囊是否可点/是否够显眼、
// 三个图标底色是否真的不同）；间距像素值属于观感，不设断言——把间距锁死只会让
// 以后微调时被迫改测试，属于「假守卫」。
// ============================================================================

const REL = 'components/AboutDialog.tsx'
const SRC = stripComments(readFileSync(join(projectRoot, REL), 'utf8'))

describe('关于弹窗', () => {
  it('A0 解析自检：拿到的是 AboutDialog 源码，且注释确实被剥掉了（防空转）', () => {
    expect(SRC.length).toBeGreaterThan(1000)
    expect(SRC).toContain('export default function AboutDialog')
    // 这句话只出现在文件头注释里；它还在 ⇒ 注释没被剥掉，下面「不得包含某词」的断言会误判
    expect(SRC).not.toContain('这是「更好看」换来的')
  })

  it('A1 版本号只出现一次，且不再和版权挤在同一行', () => {
    const count = SRC.split('NEXT_PUBLIC_VERSION').length - 1
    expect(count, '版本号应只出现一次（Hero 的版本胶囊已取消，别再加回来）').toBe(1)

    const i = SRC.indexOf('MIT 开源')
    expect(i, '页脚缺少「MIT 开源」').toBeGreaterThan(-1)
    const open = SRC.lastIndexOf('<p', i)
    const close = SRC.indexOf('</p>', i)
    expect(close).toBeGreaterThan(open)
    const line = SRC.slice(open, close)
    expect(line, '版权声明必须与开源说明同一行').toContain('© 2026')
    expect(line, '版本号已移进 GitHub 胶囊，不该再和版权挤一行').not.toContain('NEXT_PUBLIC_VERSION')
  })

  it('A2 第三方说明已精简（不再点名具体服务商）', () => {
    expect(SRC, '精简后的说明缺失').toContain('地名与天气来自第三方服务')
    expect(SRC, '不该再点名 BigDataCloud').not.toContain('BigDataCloud')
    expect(SRC, '不该再点名和风天气').not.toContain('和风天气')
  })

  it('A3 GitHub 入口仍在', () => {
    expect(SRC).toContain('github.com/yoea/orbit_note')
  })

  it('A4 ★ GitHub + 版本号是可点击胶囊，且够显眼（用户 2026-10-02 要求）', () => {
    const i = SRC.indexOf('NEXT_PUBLIC_VERSION')
    const open = SRC.lastIndexOf('<a', i)
    const close = SRC.indexOf('</a>', i)
    expect(open, '版本号必须包在 <a> 里 —— 否则「可点击」无从谈起').toBeGreaterThan(-1)
    expect(close, '<a> 未闭合').toBeGreaterThan(open)

    const pill = SRC.slice(open, close)
    expect(pill, '胶囊必须指向 GitHub 项目').toContain('github.com/yoea/orbit_note')
    expect(pill, '胶囊形状：rounded-full').toContain('rounded-full')
    // 「显眼」的可判定含义两条：文字色不能退到页脚版权那一档的次级灰；
    // 且**浅色端**必须有自己的实色底（品牌紫系，与三色图标底、顶边渐变同族，不引入新颜色）。
    // ★ 这里必须按 token 排除两种「看起来像有底色」的写法：
    //   ① 带 `dark:` 前缀的那一份（第一版只写 /bg-violet-(50|500)/，结果删掉浅色底
    //      `bg-violet-50` 不会变红——因为 `dark:bg-violet-500/15` 也含该子串）；
    //   ② `bg-transparent`（它同样以 bg- 开头，却等于没底色）。
    //   最终只认「无变体前缀 + 带色阶数字」的 token，并要求它属于品牌色系（不是灰）。
    expect(pill, '胶囊文字色应比次级灰更实，否则谈不上显眼').not.toContain('text-neutral-500')
    const pillClasses = classTokens(pill.match(/className="([^"]+)"/)?.[1] ?? '')
    const lightFill = pillClasses.filter((c) => /^bg-[a-z]+-\d+$/.test(c))
    expect(lightFill.length, '胶囊需要浅色端的实色底（只有 dark: 一份、或写成 transparent 都不算）').toBeGreaterThan(0)
    expect(
      lightFill.some((c) => /^bg-(violet|rose|orange)-\d+$/.test(c)),
      '胶囊底色应取品牌色系（与三色图标底、顶边渐变同族），灰底不叫显眼',
    ).toBe(true)
  })

  it('A5 ★ 三个核心优势的图标底色互不相同（用户要求换色）', () => {
    const tiles = SRC.match(/tile: '[^']+'/g) ?? []
    expect(tiles.length, '应有 3 条 tile 配色（每条优势一个底色）').toBe(3)
    expect(new Set(tiles).size, '三个图标底色必须互不相同').toBe(3)
    // 取的是品牌渐变的三段（橙 / 玫红 / 紫）——不引入调色板外的第四种颜色
    for (const hue of ['orange', 'rose', 'violet']) {
      expect(tiles.some((t) => t.includes(`from-${hue}-`)), `缺少 ${hue} 系底色`).toBe(true)
    }
  })
})
