import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classAttrsIn, classTokens, projectRoot } from './class-attrs'

// ============================================================================
// 键盘适配守卫
//
// ── 定稿（2026-10-30，用户选择「页面完全不动」）────────────────────────────
// iOS 键盘弹起时可视区变矮、但 dvh 不变 ⇒ 文档比可视区高出一个键盘 ⇒ iOS 允许把整页
// 拖走/推走（用户看到的「整个页面可滚动」）。这是系统行为，任何输入框都会触发。
//
// 修法：**把文档层锁死**（html overflow:hidden + body fixed）⇒ document 滚动高度归零
// ⇒ 键盘弹起时页面一寸不动，键盘直接盖在下半截。
// 代价（用户明确接受）：输入时光标可能被键盘遮住（盲打）；保存按钮要收键盘才点得到。
// 内部滚动照常：列表 / 正文 / 弹窗内容区各自 overflow-y-auto。
//
// ── 历史（全部真机否掉，别再回去）──────────────────────────────────────────
// 压整列 / 只限正文区 / 压文档根（导航栏被顶上来）/ body fixed + scrollTo 补偿（闪）/
// interactive-widget（PWA 变可滚）/ 只锁 body（仍可滚）/ 压内容列高度（布局会缩）。
// 共同点：都在跟 iOS 的键盘行为讨价还价，结果不是布局变就是还能滚。
// ============================================================================

const EDITOR = 'components/DiaryEditor.tsx'
const ENTRY = 'components/EntryView.tsx'
const TOOLBAR = 'components/MarkdownToolbar.tsx'
const AUTO = 'components/AutoTextarea.tsx'
const GLOBALS = 'app/globals.css'
// 2026-10-30 起删除：曾经按 visualViewport 压高度的 hook。不许再加回来。
const OLD_HOOK = 'lib/client/use-viewport-height.ts'

function code(rel: string): string {
  return readFileSync(join(projectRoot, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('K · 键盘弹起时页面完全不动', () => {
  const css = code(GLOBALS)

  it('K0 自检：globals.css 读得到、且确实是那份样式（否则后面全是空转）', () => {
    expect(css.length).toBeGreaterThan(2000)
    expect(css, '找不到 html 块').toMatch(/html\s*\{/)
    expect(css, '找不到 .app-height').toContain('.app-height')
  })

  it('K1 html 层不可滚（锁死文档滚动的第一步）', () => {
    expect(css, 'html 没有 overflow:hidden —— 文档仍可被键盘滚走').toMatch(
      /html\s*\{[^}]*overflow:\s*hidden/,
    )
  })

  it('K2 body 脱离文档流 + 不可滚（document 滚动高度归零，iOS 无滚可滚）', () => {
    const appHeight = css.match(/\.app-height\s*\{[^}]*\}/)
    expect(appHeight, '找不到 .app-height 规则').not.toBeNull()
    const rule = appHeight![0]
    expect(rule, 'body 没有 position: fixed —— iOS 仍能把整页滚走').toMatch(/position:\s*fixed/)
    expect(rule, 'body 没有 overflow: hidden').toMatch(/overflow:\s*hidden/)
    // 高度必须仍是 100dvh（不能用 inset:0 之类，iOS 布局视口含浏览器工具栏那一截）
    expect(rule, 'body 高度不再是 100dvh').toContain('100dvh')
  })

  it('K3 两个编辑面不许再自己算/压高度（页面完全不动，任何压缩都会让布局变）', () => {
    for (const [name, rel] of [['写页', EDITOR], ['详情页', ENTRY]] as const) {
      const src = code(rel)
      // 反向：不许再引用按可视高度压布局的写法
      expect(src, `${name}又引回了压高度的 hook`).not.toContain('useVisibleViewportHeight')
      expect(src, `${name}又出现了按可视高度设内联高度`).not.toMatch(/height:\s*visibleHeight/)
      expect(src, `${name}又出现了 maxHeight 限高`).not.toMatch(/maxHeight/)
      expect(src, `${name}又出现了 flex-basis 压高度写法`).not.toMatch(/flex:\s*`0 0 \$\{/)
    }
  })

  it('K4 压高度的 hook 已删除，不许再加回来', () => {
    expect(
      existsSync(join(projectRoot, OLD_HOOK)),
      `${OLD_HOOK} 又回来了 —— 它正是布局跳动的来源`,
    ).toBe(false)
    for (const [name, rel] of [['写页', EDITOR], ['详情页', ENTRY]] as const) {
      expect(code(rel), `${name}又 import 了已删除的 hook`).not.toContain('use-viewport-height')
    }
  })

  it('K5 写页 footer 必须 mt-auto + shrink-0（贴列底、不参与压缩）', () => {
    const editor = code(EDITOR)
    expect(editor, '写页 footer 没有 mt-auto（短正文时按钮会浮到中间）').toMatch(/<footer[^>]*mt-auto/)
    expect(editor, '写页 footer 没有 shrink-0').toMatch(/<footer[^>]*shrink-0/)
  })

  it('K6 每个页面都有自己的内部滚动容器（文档锁死后，内容必须能被滚到）', () => {
    const pages: [string, string][] = [
      ['日记列表', 'components/DiaryListView.tsx'],
      ['归档列表', 'components/ArchiveListView.tsx'],
      ['设置页', 'components/SettingsView.tsx'],
      ['导入导出深链页', 'components/BackupRestoreView.tsx'],
      ['登录页', 'app/login/page.tsx'],
    ]
    for (const [name, rel] of pages) {
      expect(code(rel), `${name}没有内部滚动容器 —— 文档锁死后内容会被裁掉`).toMatch(
        /overflow-y-auto|overflow-auto/,
      )
    }
  })

  it('K7 不得退回到「手工算像素高度」的老路', () => {
    const auto = code(AUTO)
    expect(auto, 'AutoTextarea 又出现了内联样式（高度应该由父级 flex 分配）').not.toMatch(/style=\{/)
    expect(auto, 'AutoTextarea 又出现了自己算高度的痕迹').not.toMatch(/fitHeight|getAvailableHeight/)
  })

  it('K8 工具条没有被改成 sticky/fixed（顶边缘的 fixed/sticky 会被 iOS 顶栏合成）', () => {
    expect(classTokens(code(TOOLBAR)), `${TOOLBAR} 不该把工具条粘住`).not.toContain('sticky')
  })

  it('K9 编辑区外层必须是 flex 列容器，且不得自己可滚', () => {
    for (const [name, rel] of [['写页', EDITOR], ['详情页', ENTRY]] as const) {
      const attrs = classAttrsIn(rel, code(rel)).filter(
        (a) => a.text.includes('pt-4') && a.text.includes('pb-2'),
      )
      expect(attrs.length, `${name}找不到编辑区外层容器（签名 pt-4 + pb-2），或签名不再唯一`).toBe(1)
      const tk = classTokens(attrs[0].text)
      expect(tk, `${name}编辑区外层不是 flex 容器 ⇒ 内部 textarea 的 flex-1 失效`).toContain('flex')
      expect(tk, `${name}编辑区外层缺 flex-col`).toContain('flex-col')
      expect(tk, `${name}编辑区外层缺 min-h-0`).toContain('min-h-0')
      expect(tk, `${name}编辑区外层缺 flex-1`).toContain('flex-1')
      expect(tk, `${name}编辑区外层又变成滚动容器了（会吞手势）`).not.toContain('overflow-y-auto')
    }
  })

  it('K10 页眉必须在正文之前，且不得用 flex order 重排', () => {
    for (const [name, rel] of [['写页', EDITOR], ['详情页', ENTRY]] as const) {
      expect(code(rel), `${name}又用 flex order 重排视觉顺序了`).not.toMatch(
        /\border-(?:\d+|first|last|none)\b/,
      )
    }
    const entry = code(ENTRY)
    const mainAt = entry.indexOf('max-w-md flex-1 flex-col px-5')
    expect(mainAt, '找不到详情页的 main 渲染容器').toBeGreaterThan(-1)
    const headerAt = entry.indexOf('page-header', mainAt)
    const scrollerAt = entry.indexOf('overflow-y-auto', mainAt)
    expect(headerAt, '找不到详情页页眉（.page-header）').toBeGreaterThan(-1)
    expect(scrollerAt, '找不到详情页正文滚动容器').toBeGreaterThan(-1)
    expect(headerAt, '页眉排在正文滚动容器之后').toBeLessThan(scrollerAt)
  })

  it('K11 正文区不得嵌套滚动容器：每个分支各自承担滚动', () => {
    for (const [name, rel] of [['写页', EDITOR], ['详情页', ENTRY]] as const) {
      const src = code(rel)
      const at = src.indexOf('ref={previewRef}')
      expect(at, `${name}找不到预览分支的 ref={previewRef}`).toBeGreaterThan(-1)
      const m = src.slice(at, at + 140).match(/className="([^"]*)"/)
      expect(m, `${name}预览分支的元素上没有紧跟 className`).not.toBeNull()
      const ptk = classTokens(m![1])
      expect(ptk, `${name}预览分支缺 overflow-y-auto`).toContain('overflow-y-auto')
      expect(ptk, `${name}预览分支的滚动容器缺 min-h-0`).toContain('min-h-0')
      expect(ptk, `${name}预览分支的滚动容器缺 flex-1`).toContain('flex-1')
    }
    const entryTa = classAttrsIn(ENTRY, code(ENTRY)).filter((a) => a.text.includes('resize-none'))
    expect(entryTa.length, '详情页找不到编辑 textarea（签名 resize-none）').toBe(1)
    expect(classTokens(entryTa[0].text), '详情页编辑 textarea 缺 overflow-y-auto').toContain('overflow-y-auto')
    expect(code(AUTO), 'AutoTextarea 丢了 overflow-y-auto').toContain('overflow-y-auto')
  })

  it('K12 触屏设备不在挂载时程序化聚焦（否则 iOS 留下假输入会话，首次点击键盘要等）', () => {
    const src = readFileSync(join(projectRoot, AUTO), 'utf8')
    expect(src, '没有按 pointer: coarse 分流').toContain("matchMedia('(pointer: coarse)')")
    expect(src, '触屏分支没有提前 return（还是会抢焦点）').toMatch(/isCoarsePointer\(\)\) \{[\s\S]{0,300}?return/)
    expect(src, '又把 autoFocus 属性传给 textarea 了（React 会自己聚焦，分流失效）')
      .not.toMatch(/autoFocus=\{autoFocus\}/)
  })
})
