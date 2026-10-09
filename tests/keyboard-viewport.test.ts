import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classAttrsIn, classTokens, projectRoot } from './class-attrs'

// ============================================================================
// 键盘适配守卫
//
// ── 第一版（2026-10-06 上午，用户反馈「输入长文本时 Markdown 工具条会隐藏」）──────
// 根因：编辑页高度来自 `100dvh`，而 **iOS 的键盘不改 dvh**。键盘弹起后输入框下沿落在
// 键盘底下，iOS 为了让光标可见会把**可视视口**向上滚 ⇒ 排版在最上方的那一条（页头 +
// Markdown 工具条）被顶出屏幕；写得越长滚得越多。当时的修法是用 `useVisibleViewportHeight`
// 把**整页**压到可见区高度。
//
// ── 第二版（2026-10-06 晚，用户反馈「键盘弹出后往下滑，保存按钮下方一大片空白」）─────
// 「压整页」这条路上有一个必然的副作用：被压矮的那一列下面，**布局视口那一整段仍然存在**
// （可滚动、且被 `.qo-app-root` 的整页底色填充）。用户在键盘弹起时往下滑 = 可视视口在布局
// 视口里往上滚 ⇒ 底部露出「无人绘制的那段空白」，再往下才是布局在文档底部的 TabBar。
//
// 定稿的做法（用户给的目标行为的字面实现）：「整个页面不能整体下滑，只有文字输入区域可以
// 滚动」—— 页头 / 工具条 / 底部按钮全部固定，**正文自己当滚动容器**（textarea 本身也可滚）。
// 光标在可滚动的 textarea 内部被算成「可见」，iOS 因此不会去滚可视视口。
//
// ⇒ 所以现在两个编辑面都**不该**再引用 `useVisibleViewportHeight`。hook 保留在仓库里
//   （判据本身是对的，将来若有「必须整页不动且不能有内部滚动条」的场景还会用到），
//   但下面的 K3 会把它钉成「不许回归」的样子。
// ============================================================================

const HOOK = 'lib/client/use-viewport-height.ts'
const EDITOR = 'components/DiaryEditor.tsx'
const ENTRY = 'components/EntryView.tsx'
const TOOLBAR = 'components/MarkdownToolbar.tsx'
const AUTO = 'components/AutoTextarea.tsx'

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

  it('K3 不支持 visualViewport 的环境直接返回 null（行为退回 flex 布局）', () => {
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

  // ── 下面三条是第一版结论的**反转**（2026-10-06 晚定稿）──
  it('K5 两个编辑面都不许再「压整页高度」（那是「保存按钮下方一片空白」的成因）', () => {
    for (const [name, rel] of [['写页', EDITOR], ['详情页', ENTRY]] as const) {
      const src = code(rel)
      expect(src, `${name}又引回了 useVisibleViewportHeight —— 空白问题会复发`).not.toContain('useVisibleViewportHeight')
      expect(src, `${name}又出现了 flex-basis 压高度写法`).not.toMatch(/flex:\s*`0 0 \$\{/)
      expect(src, `${name}又出现了内联 flex 覆盖（压整页的痕迹）`).not.toMatch(/0 0 \$\{\w+\}px/)
    }
  })

  it('K6 页头/底部按钮必须固定，正文是唯一滚动容器（用户给的目标行为）', () => {
    // 写页：根容器不再 overflow-hidden（它不该滚）；footer 用 shrink-0 明确「不参与压缩」。
    // （正文滚动容器的**具体形态**由 K9 校验：必须是 flex 列容器，见那条的说明。）
    const editor = code(EDITOR)
    expect(editor, '写页根容器不该再 overflow-hidden（那是它自己可滚的信号）').not.toMatch(
      /flex-col overflow-hidden px-5/,
    )
    expect(editor, '写页底部按钮必须 shrink-0（固定不动）').toMatch(
      /<footer className="relative shrink-0/,
    )

    // 详情页：main 不再滚动，正文那一块才是滚动容器。
    const entry = code(ENTRY)
    expect(entry, '详情页 main 不该自己滚（页头与底部栏必须固定）').not.toMatch(
      /flex-col overflow-y-auto px-5/,
    )
    // 查看态正文滚动容器（签名 mt-4 + overflow-y-auto，EntryView 里唯一）必须存在。
    // 注意不要在这里断言 order —— 那正是 2026-10-09 的回归来源，见 K10。
    const viewBody = classAttrsIn(ENTRY, entry).filter(
      (a) => a.text.includes('mt-4') && a.text.includes('overflow-y-auto'),
    )
    expect(viewBody.length, '详情页查看态正文缺少滚动容器（签名 mt-4 + overflow-y-auto）').toBe(1)
  })

  it('K7 不得退回到「手工算像素高度」的老路', () => {
    // 2026-08-26 之前是 getAvailableHeight() 里写死 -200 再 setHeight；
    // 那种写法既猜错了头部高度、又要靠 effect 同步，已经删掉，不要加回来。
    // ★ 判据必须落到「有没有内联高度」本身：只查 `style.height` 这种子串是不够的——
    //   JSX 里的写法是 `style={{ height: … }}`，那个子串根本不会出现（非空转验证抓到的假断言）。
    const auto = code(AUTO)
    expect(auto, 'AutoTextarea 又出现了内联样式（高度应该由父级 flex 分配）').not.toMatch(/style=\{/)
    expect(auto, 'AutoTextarea 又出现了自己算高度的痕迹').not.toMatch(/fitHeight|getAvailableHeight/)
  })

  it('K8 工具条没有被改成 sticky/fixed（治不了这个病，还多一个采样盒子）', () => {
    // 工具条本来就靠「页头/底部固定 + 正文滚动」的 flex 布局实现固定，不需要 sticky/fixed；
    // 而顶边缘出现 fixed/sticky 盒子时会被 iOS 顶栏读取并合成
    // （2026-10-02「顶部虚化」三轮踩过，见 globals.css 的说明）。
    // 工具条是共用件，只查它一处即可 —— 两个编辑面都从这里渲染。
    expect(classTokens(code(TOOLBAR)), `${TOOLBAR} 不该把工具条粘住`).not.toContain('sticky')
  })

  it('K9 编辑区滚动容器必须是 flex 列容器（否则 textarea 的 flex-1 失效、输入区塌成 2~3 行）', () => {
    // 2026-10-09 回归（用户反馈「编辑页面只有很小一块输入区域了，大概 2~3 行」）：
    // 第二版把正文包进滚动容器时写成了**块级** div，而 EDITOR_TEXTAREA_CLASS 自带 `flex-1` ——
    // `flex-1` 只在 **flex 容器**里才有意义。父级是块级 div 时它是彻底的空操作，
    // textarea 于是退回固有高度（浏览器默认 rows≈2 ⇒ 2~3 行）。
    // 与 K7「不许内联算高度」是一对：高度只能由 flex 分配，那父级就必须是 flex 容器。
    // 签名 `pt-4 pb-2` 唯一标识这个滚动容器（预览态与编辑态共用同一个元素）。
    for (const [name, rel] of [['写页', EDITOR], ['详情页', ENTRY]] as const) {
      const attrs = classAttrsIn(rel, code(rel)).filter(
        (a) => a.text.includes('pt-4') && a.text.includes('pb-2'),
      )
      expect(attrs.length, `${name}找不到编辑区滚动容器（签名 pt-4 + pb-2），或签名不再唯一`).toBe(1)
      const tk = classTokens(attrs[0].text)
      expect(tk, `${name}编辑区滚动容器不是 flex 容器 ⇒ 内部 textarea 的 flex-1 失效`).toContain('flex')
      expect(tk, `${name}编辑区滚动容器缺 flex-col ⇒ 子项会被横向排`).toContain('flex-col')
      expect(tk, `${name}编辑区滚动容器缺 min-h-0 ⇒ 压不下去、滚动条不出现`).toContain('min-h-0')
      expect(tk, `${name}编辑区滚动容器缺 flex-1 ⇒ 不占满中间区域`).toContain('flex-1')
      expect(tk, `${name}编辑区外层不再可滚（预览态会滚不动）`).toContain('overflow-y-auto')
    }
  })

  it('K10 页眉必须在正文之前，且不得用 flex order 重排（2026-10-09 回归）', () => {
    // 回归（用户反馈「查看/编辑文章页，返回按钮、日记按钮、添加按钮，以及定位和天气
    // 全部错误地显示在了输入框的下方」）：
    // 上一次改动用 `order-1` 把正文提到视觉最前、把页眉/元信息/定位一律压成 `order-10`，
    // 理由是「日期、字数、定位、编辑于是正文的落款」—— **这个前提本身是错的**：
    // 页眉里的返回 / 标题 / ＋ 本来就该在最上面。
    //
    // 教训：flex `order` 是**纯视觉重排**，DOM 顺序与画出来的顺序不一致，
    // 读源码时极易看漏（本项目的守卫也大多按源码顺序读）。这两个页面都不需要重排 ——
    // 源码顺序本来就是正确的视觉顺序。所以直接禁用 order。
    for (const [name, rel] of [['写页', EDITOR], ['详情页', ENTRY]] as const) {
      const src = code(rel)
      // \b 保证不误伤 border-*（b 与 o 都是单词字符，中间没有词边界）
      expect(src, `${name}又用 flex order 重排视觉顺序了（页眉会被挤到正文下面）`).not.toMatch(
        /\border-(?:\d+|first|last|none)\b/,
      )
    }
    // 详情页：页眉必须排在正文滚动容器**之前** —— 源码顺序即视觉顺序。
    // 锚点必须从 `main` 起算：文件上方还有一个「加载中占位」的早返回 main，它也含
    // overflow-y-auto（line ≈549），从文件头开始 indexOf 会先命中它（非空转验证抓到的）。
    const entry = code(ENTRY)
    const mainAt = entry.indexOf('<main className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col px-5">')
    expect(mainAt, '找不到详情页的 main 渲染容器').toBeGreaterThan(-1)
    const headerAt = entry.indexOf('page-header', mainAt)
    const scrollerAt = entry.indexOf('overflow-y-auto', mainAt)
    expect(headerAt, '找不到详情页页眉（.page-header）').toBeGreaterThan(-1)
    expect(scrollerAt, '找不到详情页正文滚动容器').toBeGreaterThan(-1)
    expect(headerAt, '页眉排在正文滚动容器之后 ⇒ 会显示在输入框下方').toBeLessThan(scrollerAt)
  })
})
