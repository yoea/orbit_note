import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================================
// 设置页信息架构守卫（2026-09-30 重排后加）
//
// 守的是三件"改一次就可能悄悄退回去"的事：
//   1. 分组顺序与归属 —— 「退出登录」属于账号与会话，不属于数据；「删除所有数据」属于数据，
//      但不该和「备份」同页（语义正好相反）。
//   2. 单一入口 —— 导出与导入合并成一个入口后，不许再在设置页长出第二个入口。
//   3. 旧路由留重定向 —— 合并/改造会留下 /settings/export、/settings/import、
//      /settings/passkey 三个旧地址，必须有 redirect 页兜住（书签、浏览器历史）。
//
// 断言前一律剥离注释：否则「勿搬回来」这类说明文字本身就会把断言打红，
// 逼着后来的人去删警告（footnote-contrast.test.ts 同款做法）。
// ============================================================================

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

function read(rel: string): string {
  return readFileSync(join(projectRoot, rel), 'utf8')
}

function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** 取锚点位置并**先断言它存在**：indexOf 未命中返回 -1，而 -1 小于任何正数，
 *  于是所有"先后顺序"断言会在目标被删掉时反而通过（真实踩过的坑）。 */
function pos(src: string, needle: string): number {
  const i = src.indexOf(needle)
  expect(i, `找不到锚点：${needle}`).toBeGreaterThanOrEqual(0)
  return i
}

/** 取两个锚点之间的片段（不含右界）——用于「这段逻辑确实写在这个函数里」的断言。
 *  ★ 右界必须在左界之后且唯一，否则切片会跨过整个文件造成空转。 */
function between(src: string, start: string, end: string): string {
  const a = pos(src, start)
  const b = src.indexOf(end, a)
  expect(b, `右界锚点「${end}」不在「${start}」之后 —— 切片会空转`).toBeGreaterThan(a)
  return src.slice(a, b)
}

const SETTINGS = 'components/SettingsView.tsx'
const ABOUT = 'components/AboutDialog.tsx'

describe('设置页信息架构', () => {
  it('P0 解析自检：三个分组标题都能读到（防空转）', () => {
    const src = code(SETTINGS)
    expect(src.length).toBeGreaterThan(1000)
    for (const title of ['账号与安全', '通用', '数据']) {
      expect(src, `分组标题缺失：${title}`).toContain(`>${title}</p>`)
    }
  })

  it('P1 分组顺序为「账号与安全 → 通用 → 数据」', () => {
    const src = code(SETTINGS)
    expect(pos(src, '>账号与安全</p>')).toBeLessThan(pos(src, '>通用</p>'))
    expect(pos(src, '>通用</p>')).toBeLessThan(pos(src, '>数据</p>'))
  })

  it('P2 「退出登录」在「账号与安全」组内，不在「数据」组', () => {
    const src = code(SETTINGS)
    const logout = pos(src, '>退出登录</p>')
    expect(logout).toBeGreaterThan(pos(src, '>账号与安全</p>'))
    expect(logout).toBeLessThan(pos(src, '>通用</p>'))
  })

  it('P3 导入与导出是单一入口，设置页不再直接暴露导出 / 导入两项', () => {
    const src = code(SETTINGS)
    expect(src).toContain('href="/settings/backup"')
    expect(src).toContain('>导入与导出</p>')
    expect(src).not.toContain('href="/settings/export"')
    expect(src).not.toContain('href="/settings/import"')
  })

  it('P4 删除数据不在导出面板里（危险操作不得与「备份」同页）', () => {
    const src = code('components/ExportView.tsx')
    expect(src).not.toMatch(/admin\/wipe/)
    expect(src).not.toContain('WipeDataAction')
    expect(src).not.toContain('InputConfirmDialog')
  })

  it('P5 设置页**不再**出现「删除所有数据」入口（已移入「关于 Orbit」弹窗）', () => {
    // 2026-10-10 用户要求把它挪进关于弹窗 —— 设置页里它无论怎么缩小都还是"一条设置项"的观感。
    const src = code(SETTINGS)
    expect(src, '设置页还在渲染 WipeDataAction').not.toContain('WipeDataAction')
    expect(src, '设置页还留着「危险操作」触发器').not.toContain('危险操作')
  })

  it('P6 导出 / 导入面板都不再是整页，页头由分段容器提供', () => {
    for (const f of ['components/ExportView.tsx', 'components/ImportView.tsx']) {
      expect(code(f), `${f} 不应再有 <main>`).not.toMatch(/<main[\s>]/)
    }
    const container = code('components/BackupRestoreView.tsx')
    expect(container).toMatch(/<main[\s>]/)
    expect(container).toContain('<ExportView />')
    expect(container).toContain('<ImportView />')
    expect(container).toContain('page-header')
  })

  it('P7 旧路由由 next.config 的 redirects 兜住（307），且不在 (app) 组里放 redirect 页', () => {
    // 为什么不在 (app) 组里写一个 `redirect()` 页面（像 app/history/page.tsx 那样）：
    // (app)/layout.tsx 是客户端组件且有**条件返回**——预渲染时 state 不是 'ready'，
    // 它直接返回占位 <main>，children 根本没被渲染 ⇒ 页面里的 redirect() 在预渲染时
    // 不会执行。实测：/history 的产物 .meta 里有 status:307 + location，而 (app) 组内
    // 的三个 redirect 页 .meta 里连 status 字段都没有（返回 200 的普通页）。
    // 所以这三条必须留在 next.config 的路由层，由路由匹配阶段处理。
    const src = read('next.config.ts')
    const pairs: [string, string][] = [
      ['/settings/export', '/settings/backup'],
      ['/settings/import', '/settings/backup'],
      ['/settings/passkey', '/settings'],
    ]
    for (const [source, dest] of pairs) {
      expect(
        src,
        `next.config 缺少 ${source} → ${dest} 的重定向`,
      ).toMatch(new RegExp(`source:\\s*'${source}'[^}]*destination:\\s*'${dest}'`))
    }
    // 反面：这三个路径下不该再有 page.tsx（那种写法在这里静默失效）
    for (const p of [
      'app/(app)/settings/export/page.tsx',
      'app/(app)/settings/import/page.tsx',
      'app/(app)/settings/passkey/page.tsx',
      'app/(app)/settings/passkey',
    ]) {
      expect(existsSync(join(projectRoot, p)), `${p} 不应存在——在 (app) 组里 redirect() 不生效`).toBe(false)
    }
  })

  it('P8 添加通行密钥是弹窗内的子视图，不再有跳整页的导航', () => {
    const dialog = code('components/PasskeysDialog.tsx')
    expect(dialog).not.toContain("router.push('/settings/passkey')")
    expect(dialog).toContain('AddPasskeyPanel')
    // 子视图必须把"添加成功"回传给弹窗（用于刷新列表 + 切回列表视图）
    expect(code('components/AddPasskeyPanel.tsx')).toContain('onAdded')
  })
})

// ============================================================================
// 「删除所有数据」的隐藏入口与四步流程（2026-09-30 立；2026-10-10 三次改变可发现性）
//
// 这条功能一辈子可能只用一次，权重必须压到最低。三次「降级」：
//   ① 2026-09-30 设置页末行 + 红字 → 折叠成 `危险操作 ›`（默认收起）；
//   ② 2026-10-10 上午 移出设置页 → 「关于」弹窗最底部一行小字；
//   ③ 2026-10-10（本次）**全隐藏** → 连点 LOGO「Orbit」**8 次**才出现。
// 入口越隐蔽，越要把误触代价压到零 ⇒ 流程从两步扩成**四步**（用户指定）：
//   ① 确认进入 → ② 输入「永久删除」→ ③ 通行密钥验证 → ④ 最后一次确认 → 执行。
// 容易悄悄退回去的性质各钉一条（P9~P17）。
// ============================================================================
const WIPE = 'components/WipeDataAction.tsx'
// 2026-10-29：连点 LOGO 8 次打开的不再是删除流程，而是「隐藏入口」面板（已归档 / 删除所有数据）
const HIDDEN = 'components/HiddenPanel.tsx'

describe('删除所有数据的隐藏入口与四步流程', () => {
  it('P9 解析自检：四步流程与隐藏入口的锚点都能读到（防空转）', () => {
    const wipe = code(WIPE)
    const about = code(ABOUT)
    expect(wipe.length).toBeGreaterThan(500)
    for (const needle of ['WIPE_CONFIRM_TEXT', "step === 'confirm'", "step === 'input'", "step === 'verifying'", "step === 'final'", 'startVerify']) {
      expect(wipe, `WipeDataAction 里找不到锚点「${needle}」`).toContain(needle)
    }
    expect(about, '关于弹窗里找不到连点阈值').toContain('WIPE_TAP_TARGET')
    expect(about, '关于弹窗里找不到连点处理函数').toContain('onLogoTap')
  })

  it('P10 「删除所有数据」在界面上**完全没有入口**（组件里不得再长出按钮）', () => {
    // 入口的三个历史形态（设置页末行 / 折叠器 / 关于页底部小字）都已删除。
    // 判据：WipeDataAction 里不该有任何 <button> —— 它现在只是流程，入口在 AboutDialog 的 LOGO 上。
    const wipe = code(WIPE)
    expect(wipe, 'WipeDataAction 里又长出可见入口了（它只该渲染流程弹窗）').not.toMatch(/<button/)
    expect(wipe, '「危险操作」折叠那一级不该回来').not.toContain('危险操作')
    expect(wipe, '流程起点必须是第一步确认弹窗').toContain('title="进入删除流程？"')
  })

  it('P11 入口 = 连点 LOGO 8 次（超过 2 秒的间隔重新计数）', () => {
    const about = code(ABOUT)
    expect(about, '阈值不是 8 次').toContain('const WIPE_TAP_TARGET = 8')
    // ★ 「连续」必须有界定：否则用户在几天里零散点 LOGO 也会凑够 8 次
    expect(about, '没有按间隔重置计数').toContain('if (now - lastTapRef.current > WIPE_TAP_GAP_MS) wipeTapsRef.current = 0')
    expect(about, '没有按阈值判断是否达到 8 次').toContain('if (wipeTapsRef.current >= WIPE_TAP_TARGET) {')
    // 2026-10-29：达到阈值后打开的是**隐藏面板**（里面才有「删除所有数据」这一行），
    // 不再直接进删除流程 —— 用户要求把「已归档」也收进同一扇门。
    expect(about, '达到阈值后没有打开隐藏面板').toContain('setHiddenOpen(true)')
    expect(about, '隐藏面板没有条件渲染').toContain('{hiddenOpen && (')
    // LOGO 必须真的可点（语义化 button），且绑的是计数处理器
    expect(about, 'LOGO 没有包成可点击的 button').toMatch(/<button type="button" onClick=\{onLogoTap\}/)
    expect(about, 'LOGO 不是这个 button 的内容').toMatch(/onClick=\{onLogoTap\}[^>]*>\s*<OrbitLogo/)
  })

  it('P12 四步顺序固定：确认 → 输入 → 验证 → 最后确认', () => {
    const wipe = code(WIPE)
    expect(wipe, '状态类型不是这四步').toContain("export type WipeStep = 'confirm' | 'input' | 'verifying' | 'final'")
    // 源码里的渲染顺序 = 用户看到的流程顺序
    let prev = -1
    for (const step of ["{step === 'confirm' &&", "{step === 'input' &&", "{step === 'verifying' &&", "{step === 'final' &&"]) {
      const at = pos(wipe, step)
      expect(at, `「${step}」的渲染顺序错了`).toBeGreaterThan(prev)
      prev = at
    }
    // ② 用的是输入确认弹窗（必须输对字才能往下走）
    const inputBlock = between(wipe, "{step === 'input' &&", "{step === 'verifying' &&")
    expect(inputBlock, '第二步不是「输入指定文字」的强确认').toContain('<InputConfirmDialog')
    expect(inputBlock, '第二步没有绑定强确认词').toContain('expected={WIPE_CONFIRM_TEXT}')
  })

  it('P13 通行密钥验证在**最后确认之前**，且整条流程只验一次', () => {
    const wipe = code(WIPE)
    const verifyFn = between(wipe, 'async function startVerify() {', 'async function wipe() {')
    expect(verifyFn, '验证没有真的调通行密钥').toContain('const ok = await verifyWithPasskey()')
    expect(verifyFn, '验证通过后没有进入最后确认').toContain("setStep('final')")
    expect(verifyFn, '验证未通过时静默返回（用户不知道为什么没反应）').toContain('window.alert')
    expect(verifyFn, '验证未通过后没有放弃整个流程').toContain('onClose()')
    expect(pos(wipe, 'await verifyWithPasskey()'), '验证必须在最后确认之前').toBeLessThan(pos(wipe, "{step === 'final' &&"))

    // 真正执行删除的那一段不得再验一次（身份已在第③步确认过）
    const wipeFn = between(wipe, 'async function wipe() {', '  return (')
    expect(wipeFn, '执行删除时又验了一次 —— 身份验证必须只做一次').not.toContain('verifyWithPasskey')
  })

  it('P14 最后确认是破坏性二次确认，确认后才真正执行删除', () => {
    const wipe = code(WIPE)
    const finalBlock = wipe.slice(pos(wipe, "{step === 'final' &&"))
    expect(finalBlock, '最后一步不是确认弹窗').toContain('<ConfirmDialog')
    expect(finalBlock, '最后一步不是破坏性样式').toContain('destructive')
    expect(finalBlock, '最后一步的确认没有接到执行函数').toContain('void wipe()')

    const wipeFn = between(wipe, 'async function wipe() {', '  return (')
    expect(wipeFn).toContain("fetch('/api/admin/wipe', { method: 'POST' })")
    expect(wipeFn, '没有清本地 IndexedDB（密文会留在设备上）').toContain('await idbClearAll()')
    expect(wipeFn, '没有清内存里的 DEK').toContain('clearDek()')
    expect(wipeFn, '删除后没有回到初始化页').toContain("router.replace('/setup')")
  })

  it('P15 离线在第一**步**就拦下（不让用户白走三步到验证那一步才失败）', () => {
    const wipe = code(WIPE)
    const startFn = between(wipe, 'function confirmStart() {', 'async function startVerify() {')
    expect(startFn, '第一步没有拦离线').toContain('if (disabled) { onBlocked?.(); onClose(); return }')
    expect(startFn, '第一步没有推进到输入步骤').toContain("setStep('input')")
  })

  it('P16 流程由调用方**条件渲染**（每次挂载都是干净的 state）', () => {
    // 2026-10-29 起 WipeDataAction 挂在 HiddenPanel 里（AboutDialog 只负责打开面板）。
    const hidden = code(HIDDEN)
    expect(hidden, '没有条件渲染流程 —— 每次触发必须从第一步重来').toContain('{wipeOpen && (')
    // ⚠️ 逗号分隔的 props 里有箭头函数（`{() => …}`）⇒ 正则**不能用 `[^>]*`**（会在 `=>` 的 `>`
    //    处截断，断言永远匹配不到 = 空转）。用 `[\s\S]{0,300}?` 限定在这一次组件调用内。
    expect(hidden, '没有把离线禁用传下去').toMatch(/<WipeDataAction[\s\S]{0,300}?disabled=\{wipeDisabled\}/)
    expect(hidden, '关闭时没有复位（下次点 8 次会直接又弹出来）').toMatch(
      /<WipeDataAction[\s\S]{0,300}?onClose=\{\(\) => setWipeOpen\(false\)\}/,
    )
    // 反面：不要再加一个 `open` 属性（那会要求组件自己在 effect 里重置 state）
    expect(hidden, '不要再传 open 属性 —— 用条件渲染').not.toMatch(/<WipeDataAction[\s\S]{0,300}?\bopen=/)
    // ★ 流程层必须拦住冒泡：它挂在关于弹窗的遮罩内部，点流程遮罩的空白（= 取消流程）
    //   不该继续冒泡到关于弹窗的 onClick 把整个弹窗也关掉。
    const wipe = code(WIPE)
    expect(wipe, '流程层没有拦冒泡 —— 点遮罩取消流程会连关于弹窗一起关掉').toMatch(
      /return \(\s*<div onClick=\{\(e\) => e\.stopPropagation\(\)\}>/,
    )
  })

  it('P17 嵌套弹窗安全：关于弹窗（及其祖先）不得带 transform / filter', () => {
    // 删除流程的每一层都是 `fixed inset-0 z-50`，挂在关于弹窗内部（卡片有 overflow-hidden）。
    // `position: fixed` 的包含块是**视口** ⇒ 不会被祖先的 overflow 裁掉（实测铺满 390×844）；
    // ★ 但祖先一旦成为包含块（transform / translate / rotate / scale / filter /
    //   backdrop-filter / will-change），它就退化成"相对卡片定位"并被裁进卡片里。
    // 逐帧对照实测：Temp/qo-keyboard-probe/about-nested-dialog.mjs（无 transform = 铺满视口；
    // 给卡片加 translateZ(0) = 立刻被裁成 32,234,358,610）。
    // 本项目全站零 transform / 模糊，所以这条现在成立 —— 钉住它，别在「关于」里引入。
    const about = code(ABOUT)
    for (const bad of ['transform', 'translate-', 'rotate-', 'scale-', 'filter', 'backdrop-', 'will-change']) {
      expect(about, `关于弹窗里出现了「${bad}」—— 会让嵌在内的删除确认弹窗被裁掉`).not.toContain(bad)
    }
  })
})
