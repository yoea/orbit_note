import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classAttrsIn, classTokens, projectRoot } from './class-attrs'

// ============================================================================
// 键盘适配守卫
//
// ── 历史（各版均被真机否掉，记录在此防重蹈）────────────────────────────────
// ① 压整页（069c963）⇒ 键盘下方露出可滑出来的空白；
// ② 只限正文区（v2.5.5）⇒ 没锁文档，body 仍满高可滚 ⇒ 页面照样滑；
// ③ 压文档根（v2.5.6）⇒ 导航栏/保存按钮被顶上来；
// ④ body fixed 锁 + scrollTo 补偿（v2.5.7）⇒ 闪（推上去又拽下来）；
// ⑤ interactive-widget=overlays-content（v2.5.9）⇒ PWA 页面变可滚动；
// ⑥ 只 body fixed / preventScroll / touch-action（v2.5.10~11）⇒ 仍可滚动。
//
// ── 定稿（2026-10-30，用户目标「打开键盘后整页不滚，只有输入区文字能滚」）──
// 两件事**同时**做，缺一不可：
//   1. **限高正文区**：键盘弹起时把正文区 maxHeight 压到「可视高度 − 上方固定部分」，
//      让 textarea 底边完全落在键盘上方 ⇒ iOS 的 scroll-into-view 找不到理由 ⇒ 不平移整页。
//   2. **锁文档**：给 <html> 打 data-qo-keyboard ⇒ html 不可滚 + body fixed，文档高度归零。
// 实现：`useKeyboardEditorHeight()`（lib/client/use-viewport-height.ts），写页与详情页
//   编辑态各调一次，返回 bodyRef + maxHeight。
// ============================================================================

const HOOK = 'lib/client/use-viewport-height.ts'
const EDITOR = 'components/DiaryEditor.tsx'
const ENTRY = 'components/EntryView.tsx'
const TOOLBAR = 'components/MarkdownToolbar.tsx'
const AUTO = 'components/AutoTextarea.tsx'
const GLOBALS = 'app/globals.css'

function code(rel: string): string {
  return readFileSync(join(projectRoot, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('K · 键盘弹出时的编辑区高度适配', () => {
  const hook = code(HOOK)

  it('K0 自检：hook 里确实读的是 visualViewport（否则后面全是空转）', () => {
    expect(hook.length).toBeGreaterThan(500)
    expect(hook, '没读 visualViewport —— 键盘高度根本没有来源').toContain('window.visualViewport')
    expect(hook, '没有响应 resize，键盘弹出时不会重算').toContain("addEventListener('resize'")
  })

  it('K1 只认「键盘量级」的高度差，几十像素的小差值不触发', () => {
    expect(hook, '缺少「键盘量级」常量').toMatch(/KEYBOARD_MIN_GAP\s*=\s*1\d\d/)
    expect(hook, '判据里没用上该常量').toMatch(/gap\s*>\s*KEYBOARD_MIN_GAP/)
  })

  it('K2 双指缩放时不生效（缩放会让 visualViewport.height 变小，那不是键盘）', () => {
    expect(hook, '没有排除缩放：放大网页会被误判成键盘弹出').toMatch(/scale\s*!==\s*1/)
    const guardAt = hook.indexOf('scale !== 1')
    const unlockAt = hook.indexOf('unlock()')
    expect(guardAt, '找不到 scale 判据').toBeGreaterThan(-1)
    expect(unlockAt, '找不到 scale 判据后的解锁').toBeGreaterThan(-1)
    expect(guardAt, 'scale 判据在解锁之后，拦不住').toBeLessThan(unlockAt)
  })

  it('K3 不支持 visualViewport 的环境直接返回（行为退回 flex 布局）', () => {
    expect(hook, '缺少 visualViewport 兜底').toMatch(/if\s*\(!vv\)\s*return/)
  })

  it('K4 布局视口高度取自 documentElement.clientHeight，而不是 innerHeight', () => {
    expect(hook, '基准高度没取 clientHeight —— 会把 URL 栏变化误判成键盘').toMatch(
      /root\.clientHeight|documentElement\.clientHeight/,
    )
    expect(hook, '不该用 window.innerHeight 当布局视口高度').not.toContain('window.innerHeight')
  })

  it('K5 两个编辑面接入限高正文区 + 锁文档（不得再压整页/只锁不限高）', () => {
    for (const [name, rel] of [['写页', EDITOR], ['详情页', ENTRY]] as const) {
      const src = code(rel)
      // 必须接入新 hook（限高正文区）
      expect(src, `${name}没有接入 useKeyboardEditorHeight`).toContain('useKeyboardEditorHeight()')
      expect(src, `${name}没有给正文区挂 bodyRef`).toContain('ref={bodyRef}')
      // ★ 必须断到「style 上真的用了 maxHeight」这个承载语义的完整片段——
      //   只断 /maxHeight/ 会被解构处 `const { bodyRef, maxHeight }` 兜住（假绿，实测踩过）。
      expect(src, `${name}正文区没有在 style 上应用 maxHeight`).toMatch(
        /style=\{\s*maxHeight\s*!=\s*null\s*\?\s*\{\s*maxHeight\s*\}\s*:\s*undefined\s*\}/,
      )
      // ★ 反向：不许再压整页（旧版 flex-basis 压高度写法）
      expect(src, `${name}又出现了压整页写法`).not.toMatch(/flex:\s*`0 0 \$\{/)
      expect(src, `${name}又出现了内联 flex 覆盖（压整页的痕迹）`).not.toMatch(/0 0 \$\{\w+\}px/)
    }
    // 锁文档的 CSS 必须存在（html 不可滚 + body fixed）
    const css = code(GLOBALS)
    expect(css, '键盘锁定时 html 没有锁滚动').toMatch(
      /html\[data-qo-keyboard\]\s*\{\s*overflow:\s*hidden/,
    )
    expect(css, '键盘锁定时 body 没有脱离文档流').toMatch(
      /html\[data-qo-keyboard\]\s+body\.app-height\s*\{[^}]*position:\s*fixed/,
    )
  })

  it('K6 页头/底部按钮必须固定，正文是唯一滚动容器（用户给的目标行为）', () => {
    const editor = code(EDITOR)
    expect(editor, '写页根容器不该再 overflow-hidden（那是它自己可滚的信号）').not.toMatch(
      /flex-col overflow-hidden px-5/,
    )
    expect(editor, '写页底部按钮必须 shrink-0（固定不动）').toMatch(
      /<footer[^>]*shrink-0/,
    )

    const entry = code(ENTRY)
    expect(entry, '详情页 main 不该自己滚（页头与底部栏必须固定）').not.toMatch(
      /flex-col overflow-y-auto px-5/,
    )
    const viewBody = classAttrsIn(ENTRY, entry).filter(
      (a) => a.text.includes('mt-4') && a.text.includes('overflow-y-auto'),
    )
    expect(viewBody.length, '详情页查看态正文缺少滚动容器（签名 mt-4 + overflow-y-auto）').toBe(1)
  })

  it('K7 不得退回到「手工算像素高度」的老路', () => {
    const auto = code(AUTO)
    expect(auto, 'AutoTextarea 又出现了内联样式（高度应该由父级 flex 分配）').not.toMatch(/style=\{/)
    expect(auto, 'AutoTextarea 又出现了自己算高度的痕迹').not.toMatch(/fitHeight|getAvailableHeight/)
  })

  it('K8 工具条没有被改成 sticky/fixed（治不了这个病，还多一个采样盒子）', () => {
    expect(classTokens(code(TOOLBAR)), `${TOOLBAR} 不该把工具条粘住`).not.toContain('sticky')
  })

  it('K9 编辑区外层必须是 flex 列容器，且**不得**自己可滚（K11 的反面）', () => {
    for (const [name, rel] of [['写页', EDITOR], ['详情页', ENTRY]] as const) {
      const attrs = classAttrsIn(rel, code(rel)).filter(
        (a) => a.text.includes('pt-4') && a.text.includes('pb-2'),
      )
      expect(attrs.length, `${name}找不到编辑区外层容器（签名 pt-4 + pb-2），或签名不再唯一`).toBe(1)
      const tk = classTokens(attrs[0].text)
      expect(tk, `${name}编辑区外层不是 flex 容器 ⇒ 内部 textarea 的 flex-1 失效`).toContain('flex')
      expect(tk, `${name}编辑区外层缺 flex-col ⇒ 子项会被横向排`).toContain('flex-col')
      expect(tk, `${name}编辑区外层缺 min-h-0 ⇒ 压不下去`).toContain('min-h-0')
      expect(tk, `${name}编辑区外层缺 flex-1 ⇒ 不占满中间区域`).toContain('flex-1')
      expect(tk, `${name}编辑区外层又变成滚动容器了`).not.toContain('overflow-y-auto')
    }
  })

  it('K11 正文区不得嵌套滚动容器：每个分支各自承担滚动', () => {
    for (const [name, rel] of [['写页', EDITOR], ['详情页', ENTRY]] as const) {
      const src = code(rel)
      const at = src.indexOf('ref={previewRef}')
      expect(at, `${name}找不到预览分支的 ref={previewRef}`).toBeGreaterThan(-1)
      const m = src.slice(at, at + 140).match(/className="([^"]*)"/)
      expect(m, `${name}预览分支的元素上没有紧跟 className`).not.toBeNull()
      const ptk = classTokens(m![1])
      expect(ptk, `${name}预览分支缺 overflow-y-auto ⇒ 预览内容一多就滚不动`).toContain('overflow-y-auto')
      expect(ptk, `${name}预览分支的滚动容器缺 min-h-0`).toContain('min-h-0')
      expect(ptk, `${name}预览分支的滚动容器缺 flex-1`).toContain('flex-1')
    }
    const entryTa = classAttrsIn(ENTRY, code(ENTRY)).filter((a) => a.text.includes('resize-none'))
    expect(entryTa.length, '详情页找不到编辑 textarea（签名 resize-none）').toBe(1)
    expect(classTokens(entryTa[0].text), '详情页编辑 textarea 缺 overflow-y-auto').toContain('overflow-y-auto')
    expect(code(AUTO), 'AutoTextarea 丢了 overflow-y-auto').toContain('overflow-y-auto')
  })

  it('K10 页眉必须在正文之前，且不得用 flex order 重排', () => {
    for (const [name, rel] of [['写页', EDITOR], ['详情页', ENTRY]] as const) {
      const src = code(rel)
      expect(src, `${name}又用 flex order 重排视觉顺序了`).not.toMatch(
        /\border-(?:\d+|first|last|none)\b/,
      )
    }
    const entry = code(ENTRY)
    const mainAt = entry.indexOf('<main className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col px-5">')
    expect(mainAt, '找不到详情页的 main 渲染容器').toBeGreaterThan(-1)
    const headerAt = entry.indexOf('page-header', mainAt)
    const scrollerAt = entry.indexOf('overflow-y-auto', mainAt)
    expect(headerAt, '找不到详情页页眉（.page-header）').toBeGreaterThan(-1)
    expect(scrollerAt, '找不到详情页正文滚动容器').toBeGreaterThan(-1)
    expect(headerAt, '页眉排在正文滚动容器之后').toBeLessThan(scrollerAt)
  })

  it('K12 触屏设备不在挂载时程序化聚焦（否则 iOS 留下假输入会话，首次点击键盘要等）', () => {
    const src = readFileSync(join(projectRoot, AUTO), 'utf8')
    expect(src, '没有按 pointer: coarse 分流').toContain("matchMedia('(pointer: coarse)')")
    expect(src, '触屏分支没有提前 return（还是会抢焦点）').toMatch(/isCoarsePointer\(\)\) \{[\s\S]{0,300}?return/)
    expect(src, '又把 autoFocus 属性传给 textarea 了（React 会自己聚焦，分流失效）')
      .not.toMatch(/autoFocus=\{autoFocus\}/)
  })
})
