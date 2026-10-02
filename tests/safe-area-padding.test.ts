import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classTokens, projectClassAttrs, projectRoot, stripComments } from './class-attrs'

// ============================================================================
// 底部留白 / 安全区守卫
//
// 约定（(app)/layout 与 TabBar 的注释里也写了同一份）：
//   · (app) 组内页面是**容器滚动**，底部安全区由 TabBar 的 pb-safe 独占；
//     页面内容区自带 pb-4（16px），既不吃 safe-pb，也不再自建占位元素。
//   · 组外页面（login / setup / error）与全屏覆盖层（SearchDialog）底部直接贴视口，
//     必须用 .pb-safe = max(env(safe-area-inset-bottom), 1rem)。
//
// 为什么不许用 .safe-pb：
//   .safe-pb 只有 env(safe-area-inset-bottom)，**没有 1rem 下限**。
//   在没有 home indicator 的环境（桌面浏览器、旧 iPhone）它算出来就是 0，
//   贴底元素会紧贴容器底边甚至落进系统覆盖区。
//   这不是理论风险：登录页版本页脚「在 iPhone 上不显示」的真实事故里，就有一环是它。
//
// 历史漂移（2026-09-29 统一）：
//   底部留白曾有四种取值——ExportView 无、DiaryEditor/EntryView pb-4、
//   SettingsView <div class="h-10"> 占位、DiaryListView pb-10；
//   弹窗底部操作按钮有 py-2.5 / py-3.5 两种。现在全部收敛。
//
// 2026-09-30：导出 / 导入合并为「备份与恢复」单入口后，容器角色从 ExportView / ImportView
//   转移到 BackupRestoreView（前两者降级为嵌在分段里的面板，不再有 <main> 与页面级留白）。
//   G3 的目标列表随之替换——这是这条守卫唯一一次"换靶心"，不是放宽。
// ============================================================================

const attrs = projectClassAttrs()

function tokensOf(relFile: string): string[] {
  return attrs.filter((a) => a.file === relFile).flatMap((a) => classTokens(a.text))
}

describe('底部留白与安全区', () => {
  it('G0 解析自检：能按文件名取到 token', () => {
    // 这条是「防空转」断言。Windows 上 path.join 产出反斜杠路径，若不做归一化，
    // 下面所有按文件名查 token 的断言都会因为「一个都查不到」而**静默通过**。
    // 宁可让自检先炸，也不要一组永远绿的假守卫。
    expect(attrs.length).toBeGreaterThan(100)
    expect(tokensOf('components/TabBar.tsx')).toContain('pb-safe')
  })

  it('G1 不再使用 .safe-pb（无 home indicator 时算出来是 0）', () => {
    const offenders = attrs
      .filter((a) => classTokens(a.text).includes('safe-pb'))
      .map((a) => `${a.file}:${a.line}`)
    expect(offenders).toEqual([])
  })

  it('G2 贴视口底部的容器用 .pb-safe（含 1rem 下限）', () => {
    // 全屏覆盖层与组外页面：底部没有 TabBar 兜底，必须自己保证留白
    const targets = [
      'app/login/page.tsx',
      'app/setup/page.tsx',
      'app/error.tsx',
      'app/(app)/layout.tsx', // 连接失败态：该分支不渲染 TabBar
      'components/UnlockPrompt.tsx',
      'components/TabBar.tsx',
      'components/SearchDialog.tsx',
    ]
    const missing = targets.filter((rel) => !tokensOf(rel).includes('pb-safe'))
    expect(missing).toEqual([])
  })

  it('G3 (app) 组内页面内容区底部留白统一为 pb-4', () => {
    const targets = [
      'components/SettingsView.tsx',
      'components/BackupRestoreView.tsx',
      'components/DiaryListView.tsx',
      'components/DiaryEditor.tsx',
      'components/EntryView.tsx',
    ]
    const missing = targets.filter((rel) => !tokensOf(rel).includes('pb-4'))
    expect(missing).toEqual([])
  })

  it('G4 弹窗底部操作按钮统一为 py-3.5', () => {
    // 前三个弹窗的底部按钮已收敛到 lib/client/ui.ts 的 DIALOG_FOOTER_BUTTON_CLASS，
    // className 原文里只剩常量名——classAttrsIn 在解析阶段就把常量展开成真实 class 串，
    // 所以这里仍然按 token 判定（不展开的话这条会因为「查不到 py-3.5」而静默变红/空转）。
    const targets = [
      'components/AboutDialog.tsx',
      'components/PasskeysDialog.tsx',
      'components/RecoveryRegenerateDialog.tsx',
      'components/PrefsDialog.tsx',
      'components/ConfirmDialog.tsx',
      'components/InputConfirmDialog.tsx',
      'components/NameEditDialog.tsx',
    ]
    const missing = targets.filter((rel) => !tokensOf(rel).includes('py-3.5'))
    expect(missing).toEqual([])
  })

  it('G5 ConfettiBurst 锚定在父级 footer，不用 fixed + 写死像素偏移', () => {
    // fixed + bottom-44（写死 176px）曾与 TabBar/footer 的实际高度脱钩：
    // 那个数字等于 TabBar 高 + footer 高，任一改动都会让爆发原点漂移且无人察觉。
    const tokens = tokensOf('components/ConfettiBurst.tsx')
    expect(tokens).not.toContain('fixed')
    expect(tokens.filter((t) => /^bottom-/.test(t))).toEqual([])
    expect(tokens).toContain('absolute')
    expect(tokens).toContain('top-0')
  })
})

// ============================================================================
// 顶部安全区：必须是不滚动的独立一层（2026-10-02 修「顶部轻微虚化」）
//
// 根因：iOS 对半透明状态栏做**系统级模糊**，模糊的是它下面那一层内容。
//   此前 safe-pt 挂在各页面的滚动容器上（SettingsView / EntryView / BackupRestoreView 都是
//   overflow-y-auto + safe-pt），内容一滚就滑进状态栏底下 ⇒ 顶端一条轻微虚化；
//   而全屏覆盖层（SearchDialog）与固定页头是「不滚动的块」⇒ 没有虚化。
//   这就是用户看到的「搜索页与应用首页表现不一致」。
//   修法：把 safe-pt 收到 (app)/layout 里一个不滚动的占位块上，各页面一律不再自带。
// ============================================================================
describe('顶部安全区（不滚动）', () => {
  it('G6 safe-pt 不得与 overflow-y-auto 出现在同一个元素上', () => {
    const offenders = projectClassAttrs()
      .filter((a) => {
        const tokens = classTokens(a.text)
        return tokens.includes('safe-pt') && tokens.includes('overflow-y-auto')
      })
      .map((a) => `${a.file}:${a.line}`)
    expect(offenders, '滚动容器带 safe-pt：内容会滑进状态栏底下 → iOS 系统模糊').toEqual([])
  })

  it('G7 (app)/layout 提供不滚动的顶部安全区占位块', () => {
    const tokens = tokensOf('app/(app)/layout.tsx')
    expect(tokens, '缺少安全区占位块').toContain('safe-pt')
    expect(tokens, '占位块不能自己滚').not.toContain('overflow-y-auto')
    // 占位块必须不参与伸缩（否则会被内容挤没）
    expect(tokens).toContain('shrink-0')
  })

  it('G8 (app) 组内页面不再自带 safe-pt（由 layout 统一提供，避免双份留白）', () => {
    // 组外页面（login/setup/error）与全屏覆盖层（SearchDialog）不经过 layout，各自保留 safe-pt
    const targets = [
      'components/SettingsView.tsx',
      'components/EntryView.tsx',
      'components/DiaryListView.tsx',
      'components/DiaryEditor.tsx',
      'components/BackupRestoreView.tsx',
    ]
    const offenders = targets.filter((rel) => tokensOf(rel).includes('safe-pt'))
    expect(offenders, '这些页面由 layout 提供安全区，自己再写一份会叠出双份留白').toEqual([])
  })

  // ── 2026-10-02 二次修「顶部虚化」：光「不滚动」不够，占位块还必须**实色 + sticky** ──
  //
  // iOS 26 / Safari 26 的 Liquid Glass 顶栏是半透明玻璃，会实时合成它下面那层像素；
  // 底色按「该边缘上 fixed/sticky 元素的 background-color」推导 ⇒ 透明占位块等于没做，
  // 采样落空后回退到系统默认玻璃，下层内容直接透出来（= 用户看到的虚化）。
  it('G9 顶部安全区占位块是流内实色块，且**不得**是 sticky（2026-10-02 第三轮定论）', () => {
    // 注意：同一文件里还有一个 `flex-1 … safe-pt` 的加载态占位 <main>（那不是顶部安全区），
    // 所以这里按「同时有 shrink-0」把真正的占位块挑出来，否则会断言到错的元素上。
    const strip = projectClassAttrs()
      .find((a) => {
        const t = classTokens(a.text)
        return a.file === 'app/(app)/layout.tsx' && t.includes('safe-pt') && t.includes('shrink-0')
      })
    expect(strip, '找不到顶部安全区占位块（G7 已断言它存在，这里按元素取更精确的断言）').toBeTruthy()
    const t = classTokens(strip!.text)
    expect(t, '必须有实色底（浅色端）：那一层必须是一整块纯色，玻璃合成它才不会显形').toContain('bg-white')
    expect(t, '必须有实色底（深色端）').toContain('dark:bg-neutral-950')
    expect(t, '占位块不能是透明的').not.toContain('bg-transparent')
    // ★ 反向钉死：顶边缘的 fixed/sticky 元素会被系统顶栏读取并合成（Safari 26 已知行为）。
    //   第二轮曾给它加过 sticky，结果「滚动后虚化重现」——别再加回来。
    expect(t, '顶部占位块不得是 sticky：会把自己卷进顶栏的采样/合成链路').not.toContain('sticky')
  })

  it('G10 globals.css 里 html 显式声明背景色 + 文档层不橡皮筋', () => {
    const css = readFileSync(join(projectRoot, 'app/globals.css'), 'utf8')
    // 回退链的最后一环：顶栏找不到可采样元素时会读 html/body 背景，必须也是实色
    expect(css, 'html 未显式声明背景色').toMatch(/html\s*\{[^}]*background-color:\s*var\(--background\)/)
    // 文档层橡皮筋会把整页拖出背景带，那条带子正好落在系统栏底下
    expect(css, 'body 未禁止 overscroll').toMatch(/body\s*\{[^}]*overscroll-behavior:\s*none/)
  })

  it('G11 ★ .safe-pt 只写 env() 原值，不得"替系统/浏览器预留"留白', () => {
    // 两轮试错的沉淀：留白高度 = 系统顶栏的真实高度 = `env(safe-area-inset-top)`，由系统报，不由我们猜。
    //   · `@media (display-mode: browser) → max(env, 6rem)`：假定 Safari 地址栏在顶部，
    //     但 iOS 26 默认 Compact、地址栏在底部 ⇒ 白吃 40 多 px 空白（v1.27.1 撤回）。
    //   · `@media (pointer: coarse) → max(env, 2.75rem)`：假定 env 可能算成 0；
    //     但 env 为 0 恰说明系统没东西压在内容上 ⇒ 垫一块就是纯空白（v1.27.2 撤回）。
    // ★ 必须剥注释再断言：globals.css 里那段「两次加保险都加错了」的注释本身就写着这些关键字，
    //   不剥会让下面两条反向断言自己把自己判红。
    const css = stripComments(readFileSync(join(projectRoot, 'app/globals.css'), 'utf8'))

    const defs = [...css.matchAll(/\.safe-pt\s*\{[^}]*\}/g)].map((m) => m[0])
    expect(defs.length, '`.safe-pt` 只应有一条定义（多一条就是在凭空加留白）').toBe(1)
    expect(defs[0], '`.safe-pt` 必须就是 env() 原值').toMatch(/padding-top:\s*env\(safe-area-inset-top\)\s*;/)

    expect(css, '不得再按 pointer 加下限（会凭空垫出一块空白）').not.toMatch(/pointer:\s*coarse/)
    expect(css, '不得再按 display-mode: browser 预留浏览器 chrome').not.toMatch(/display-mode:\s*browser/)
  })

  it('G12 ★ App 根元素必须是「fixed + 实色」的盒子 —— iOS 26 顶部渐隐的唯一开关', () => {
    // 那条「顶部渐隐」是系统画的（soft 版滚动边缘效果 = 微弱模糊 + 一层渐变纱），
    // WebKit 只在满足**全部**条件时才关掉它（判据见 WebKit 源码 LocalFrameView::fixedContainerEdges）：
    //   页面里存在 fixed/sticky 盒子 → 在「视口顶部往下 4px、水平中点」命中 → 向上找第一个
    //   fixed/sticky 祖先 → 要求 ≥90% 视口宽、≤105% 视口高、**≥10px 高** → 取它的 background-color。
    // ★ 最后那条 ≥10px 是踩过两次的坑：独立窗口里 env(safe-area-inset-top) 是 0，
    //   按它做的顶部占位条算出来 0px 高，永远命中不了。
    const root = projectClassAttrs().find((a) => classTokens(a.text).includes('qo-app-root'))
    expect(root, '找不到 App 根元素（app/layout.tsx 里的 .qo-app-root）').toBeTruthy()
    const t = classTokens(root!.text)
    expect(t, '根元素必须有实色底：WebKit 取的就是它的 background-color').toContain('bg-white')
    expect(t, '深色端同样要有实色底').toContain('dark:bg-neutral-950')

    const css = stripComments(readFileSync(join(projectRoot, 'app/globals.css'), 'utf8'))
    expect(css, '缺少「独立窗口下把根元素做成 fixed 满屏」的规则').toMatch(
      /@media \(display-mode: standalone\)[\s\S]{0,200}\.qo-app-root\s*\{\s*position:\s*fixed;\s*inset:\s*0;/,
    )
    // 必须限定在 standalone：浏览器的视口高度语义不同（dvh vs 布局视口），全局 fixed 会顶掉贴底元素
    expect(css, 'fixed 规则必须包在 display-mode: standalone 里').toMatch(
      /@media \(display-mode: standalone\)[\s\S]{0,200}\.qo-app-root/,
    )
  })
})
