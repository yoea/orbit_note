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
// 「删除所有数据」的降级与折叠（2026-09-30 立；2026-10-10 用户第二次要求继续降级）
//
// 这个功能的使用频率极低（一辈子可能一次），却曾经是设置页最后一行、红字带副标题——权重过高。
// 两次降级：
//   ① 2026-09-30「默认收起」（disclosure）：默认视图里没有红色项，红色删除项要展开才出现；
//   ② 2026-10-10「入口整体移出设置页」→ 落到「关于 Orbit」弹窗最底部，触发器缩成居中中性小字。
// 三道门槛始终不变：折叠 → 输入「永久删除」→ 通行密钥验证。
// 容易悄悄退回去的性质各钉一条（P9~P15）。
// ============================================================================
const WIPE = 'components/WipeDataAction.tsx'

describe('删除所有数据的折叠', () => {
  it('P9 解析自检：触发器与删除项都能读到（防空转）', () => {
    const src = code(WIPE)
    expect(src).toContain('>危险操作</p>')
    expect(src).toContain('>删除所有数据</p>')
  })

  it('P10 删除项在展开分支内，触发器不可见红字', () => {
    const src = code(WIPE)
    // 触发器靠 aria-expanded + 状态位控制；删除项必须排在展开条件之后
    expect(src).toContain('aria-expanded={open}')
    expect(pos(src, 'aria-expanded={open}')).toBeLessThan(pos(src, '>删除所有数据</p>'))
    expect(pos(src, 'open &&')).toBeLessThan(pos(src, '>删除所有数据</p>'))
    // 默认收起：状态初值必须是 false（写成 true 等于没折）
    expect(src).toMatch(/useState\(false\)/)
  })

  it('P11 折叠触发器不被离线态置灰（置灰只作用在展开后的删除行）', () => {
    const src = code(WIPE)
    // ⚠️ 切片必须覆盖**整个 `<button>`**：原先切到 `aria-expanded={open}` 为止，而 `className`
    //    排在它**后面** ⇒ 那半句永远看不到 className，是一条**空转**守卫（2026-10-10 顺手修掉）。
    const start = pos(src, 'onClick={() => setOpen')
    const trigger = src.slice(src.lastIndexOf('<button', start), src.indexOf('</button>', start))
    expect(trigger, '触发器切片为空 —— 解析失败，断言会空转').toContain('className')
    expect(trigger, '触发器上出现了禁用相关样式').not.toMatch(/opacity-50|disabled/)
    // 而删除行仍保留离线置灰（disabled 由 prop 传入）
    expect(src).toContain('if (disabled) { onBlocked?.(); return }')
  })

  it('P12 根节点是普通块级 <div>（不再依赖列表上下文 —— 它现在挂在弹窗里）', () => {
    // 挂进「关于」弹窗后它不再是列表项：再返回 <li> 就是"游离的列表项"，
    // 而弹窗里没有 <ul> 可依托 —— HTML 结构非法。
    const src = code(WIPE)
    expect(src, '不该再有 <li>：它不是设置页的列表项了').not.toMatch(/<li>/)
    expect(src, '根节点必须是 <div>，放哪都合法').toMatch(/return \(\s*<div>/)
  })

  it('P13 入口挂在「关于 Orbit」弹窗的**最底部**（2026-10-10 第二次降级）', () => {
    // 用户原话：「把『删除所有数据』入口挪进『关于 Orbit』弹窗的最底部。」
    // 为什么再挪：在设置页里它无论怎么缩小，读起来都还是"一条设置项"。
    const about = code(ABOUT)
    expect(about, '关于弹窗里没有渲染 WipeDataAction').toContain('<WipeDataAction')
    // 必须在页脚（版权 / 第三方说明）**之后** ⇒ 才算"最底部"
    expect(
      pos(about, '<WipeDataAction'),
      '「删除所有数据」不在弹窗最底部（应排在页脚的第三方说明之后）',
    ).toBeGreaterThan(pos(about, '地名与天气来自第三方服务'))
    // 离线禁用要随弹窗传下去（与设置页其余写操作一致）
    expect(about, '没有把离线禁用传给 WipeDataAction').toMatch(/<WipeDataAction[^>]*disabled=/)
  })

  it('P15 弹窗套弹窗安全：卡片及其祖先不得带 transform / filter（否则嵌套的确认弹窗会被裁）', () => {
    // WipeDataAction 展开后点删除会再开一层 InputConfirmDialog（同样 `fixed inset-0 z-50`），
    // 而它挂在**卡片内部**，卡片有 `overflow-hidden`。
    // `position: fixed` 的包含块是**视口** ⇒ 不会被祖先的 overflow 裁掉（实测铺满 390×844）；
    // ★ 但祖先一旦成为包含块（transform / translate / rotate / scale / filter /
    //   backdrop-filter / will-change），它就退化成"相对卡片定位"并被裁进卡片里。
    // 逐帧对照实测：Temp/qo-keyboard-probe/about-nested-dialog.mjs（无 transform = 铺满视口；
    // 给卡片加 translateZ(0) = 立刻被裁成 32,234,358,610）。
    // 本项目全站零 transform / 模糊，所以这条现在成立 —— 钉住它，别在「关于」里引入。
    const about = code(ABOUT)
    for (const bad of ['transform', 'translate-', 'rotate-', 'scale-', 'filter', 'backdrop-', 'will-change']) {
      expect(
        about,
        `关于弹窗里出现了「${bad}」—— 会让嵌在卡片里的删除确认弹窗被裁掉`,
      ).not.toContain(bad)
    }
  })

  it('P14 折叠触发器已降级为「居中 + 小字 + 中性色」的一行，不再是整行设置项', () => {
    const src = code(WIPE)
    const start = pos(src, 'onClick={() => setOpen')
    const trigger = src.slice(src.lastIndexOf('<button', start), src.indexOf('</button>', start))
    expect(trigger, '触发器切片为空 —— 解析失败，断言会空转').toContain('className')
    // 居中：★ w-fit 必需 —— 块级 flex 元素默认占满整行，只写 mx-auto 是**空操作**，不会居中。
    expect(trigger, '触发器没有居中').toContain('mx-auto')
    expect(trigger, '只写 mx-auto 不写 w-fit —— 块级元素占满整行时居中不生效').toContain('w-fit')
    expect(trigger, '触发器字号没降档，读起来还是一条正常设置项').toContain('text-xs')
    expect(trigger, '触发器不是中性色（危险色只能出现在展开之后）').toContain('text-neutral-500')
  })
})
