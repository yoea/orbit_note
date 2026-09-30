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
//   2. 单一入口 —— 导出与导入合并成「备份与恢复」一行后，不许再在设置页长出第二个入口。
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

  it('P3 导出与导入是单一入口，设置页不再直接暴露导出 / 导入两项', () => {
    const src = code(SETTINGS)
    expect(src).toContain('href="/settings/backup"')
    expect(src).toContain('>导出与导入</p>')
    expect(src).not.toContain('href="/settings/export"')
    expect(src).not.toContain('href="/settings/import"')
  })

  it('P4 删除数据不在导出面板里（危险操作不得与「备份」同页）', () => {
    const src = code('components/ExportView.tsx')
    expect(src).not.toMatch(/admin\/wipe/)
    expect(src).not.toContain('WipeDataAction')
    expect(src).not.toContain('InputConfirmDialog')
  })

  it('P5 删除数据由 WipeDataAction 承载，且排在「数据」组内', () => {
    const src = code(SETTINGS)
    expect(pos(src, '<WipeDataAction')).toBeGreaterThan(pos(src, '>数据</p>'))
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
// 「删除所有数据」的折叠（2026-09-30）
//
// 这个功能的使用频率极低，却曾经是设置页最后一行、红字带副标题——权重过高，且正好停在
// 拇指滑到底的位置。改成默认收起后有三条容易悄悄退回去的性质，各钉一条：
//   1. 默认视图里只有中性色的折叠触发器，红色删除项要展开才出现；
//   2. 触发器是"展开/收起"，不该被离线态置灰（它不联网）；
//   3. 折叠不能破坏 WipeDataAction「就是一个 <li>」的契约（设置页把它直接塞进 <ul>）。
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
    const trigger = src.slice(pos(src, "onClick={() => setOpen"), pos(src, 'aria-expanded={open}'))
    expect(trigger, '触发器上出现了禁用相关样式').not.toMatch(/opacity-50|disabled/)
    // 而删除行仍保留离线置灰（disabled 由 prop 传入）
    expect(src).toContain('if (disabled) { onBlocked?.(); return }')
  })

  it('P12 仍然是单个 <li>（设置页把它直接放进 <ul>，嵌套 li 是非法结构）', () => {
    const src = code(WIPE)
    expect((src.match(/<li>/g) ?? []).length).toBe(1)
    expect(src).not.toMatch(/<li>[^]*?<li>/)
  })
})
