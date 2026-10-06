import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classTokens, projectRoot } from './class-attrs'

// ============================================================================
// 键盘高度适配守卫（2026-10-06，用户反馈「输入长文本时 Markdown 工具条会隐藏」）
//
// 根因：编辑页高度来自 `100dvh`，而 **iOS 的键盘不改 dvh**。键盘弹起后输入框下沿落在
// 键盘底下，iOS 为了让光标可见会把**可视视口**向上滚 ⇒ 排版在最上方的那一条（页头 +
// Markdown 工具条）被顶出屏幕；写得越长滚得越多。同一个根因还会遮住「保存」按钮。
//
// 这些断言守的是「别把这条路又拆了」，以及三个**保守判据**——它们决定了这个 hook
// 在什么情况下**故意不生效**（宁可不生效，也不要算错高度把界面搞乱）：
//   ① 双指缩放时不生效；② 只认「键盘量级」的高度差；③ 没有 visualViewport 就什么都不做。
// ============================================================================

const HOOK = 'lib/client/use-viewport-height.ts'
const EDITOR = 'components/DiaryEditor.tsx'
const ENTRY = 'components/EntryView.tsx'
const TOOLBAR = 'components/MarkdownToolbar.tsx'

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
    // URL 栏收缩、分屏、软键盘收起等都会产生小差值；按它们改高度会让界面莫名变矮
    expect(hook, '缺少「键盘量级」常量').toMatch(/KEYBOARD_MIN_GAP\s*=\s*1\d\d/)
    expect(hook, '判据里没用上该常量').toMatch(/gap\s*>\s*KEYBOARD_MIN_GAP/)
  })

  it('K2 双指缩放时不生效（缩放会让 visualViewport.height 变小，那不是键盘）', () => {
    expect(hook, '没有排除缩放：放大网页会被误判成键盘弹出').toMatch(/scale\s*!==\s*1/)
    // 判据必须在「算 gap / setState」之前——放在后面等于没拦
    const guardAt = hook.indexOf('scale !== 1')
    const setAt = hook.indexOf('setHeight(')
    expect(guardAt, '找不到 scale 判据').toBeGreaterThan(-1)
    expect(setAt, '找不到 setHeight 调用').toBeGreaterThan(-1)
    expect(guardAt, 'scale 判据在 setState 之后，拦不住').toBeLessThan(setAt)
  })

  it('K3 不支持 visualViewport 的环境直接返回 null（行为退回 flex 布局，与改造前一致）', () => {
    expect(hook, '缺少 visualViewport 兜底').toMatch(/if\s*\(!vv\)\s*return/)
  })

  it('K4 布局视口高度取自 documentElement.clientHeight，而不是 innerHeight', () => {
    // outerHeight 会被浏览器工具栏影响；innerHeight 在 iOS 上跟着键盘/host 行为漂移，
    // 用它当基准会把「不是键盘」的场景也算成键盘。布局视口高度只有 clientHeight 是准的。
    expect(hook, '基准高度取了 innerHeight —— 会把 URL 栏变化误判成键盘').toContain(
      'document.documentElement.clientHeight',
    )
    expect(hook, '不该用 window.innerHeight 当布局视口高度').not.toContain('window.innerHeight')
  })

  it('K5 写页用上它：整页压到可见区，键盘收起时立刻退回 flex 布局', () => {
    const src = code(EDITOR)
    expect(src, '写页没有引用该 hook —— 工具栏还是会被顶出屏幕').toContain('useVisibleViewportHeight()')
    expect(src, '没有把可见高度落到 flex-basis 上').toMatch(/flex:\s*`0 0 \$\{visibleHeight\}px`/)
    // 必须是**条件**样式：键盘不在（null）时元素要保持原来的 flex-1
    expect(src, '样式必须按 visibleHeight 是否存在来切换').toMatch(/visibleHeight\s*\?/)
  })

  it('K6 详情页也接上了，且**只在编辑态**压高度（查看态本来就要能滚）', () => {
    const src = code(ENTRY)
    expect(src, '详情页没有引用该 hook').toContain('useVisibleViewportHeight()')
    expect(src, '详情页缺 flex-basis 写法').toMatch(/flex:\s*`0 0 \$\{visibleHeight\}px`/)
    expect(src, '详情页必须限定编辑态，否则查看态会失去滚动').toMatch(/editing\s*&&\s*visibleHeight\s*\?/)
  })

  it('K7 不得退回到「手工算像素高度」的老路', () => {
    // 2026-08-26 之前是 getAvailableHeight() 里写死 -200 再 setHeight；
    // 那种写法既猜错了头部高度、又要靠 effect 同步，已经删掉，不要加回来。
    // ★ 判据必须落到「有没有内联高度」本身：只查 `style.height` 这种子串是不够的——
    //   JSX 里的写法是 `style={{ height: … }}`，那个子串根本不会出现（非空转验证抓到的假断言）。
    const auto = code('components/AutoTextarea.tsx')
    expect(auto, 'AutoTextarea 又出现了内联样式（高度应该由父级 flex 分配）').not.toMatch(/style=\{/)
    expect(auto, 'AutoTextarea 又出现了自己算高度的痕迹').not.toMatch(/fitHeight|getAvailableHeight/)
  })

  it('K8 工具条没有被改成 sticky/fixed（治不了这个病，还多一个采样盒子）', () => {
    // 布局视口根本没在滚（滚的是**可视**视口），sticky/fixed 追不上它；
    // 而顶边缘出现 fixed/sticky 盒子时会被 iOS 顶栏读取并合成
    // （2026-10-02「顶部虚化」三轮踩过，见 globals.css 的说明）。
    // 工具条是共用件，只查它一处即可 —— 两个编辑面都从这里渲染。
    expect(classTokens(code(TOOLBAR)), `${TOOLBAR} 不该把工具条粘住`).not.toContain('sticky')
  })
})
