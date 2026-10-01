import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================================
// 偏好设置守卫（2026-09-30 加 A1/A2/B 档时新建）
//
// 本项目偏好有三处「必须同时改」的地方，漏一处就是隐性 bug（只在本机生效、
// 或设置页根本看不见），而它们分处客户端与服务端两个文件、靠人眼同步：
//   1. lib/client/prefs.ts 的 ALL_KEYS —— 漏了 → 登录时拉不回服务器值；
//   2. app/api/prefs/route.ts 的 PREF_KEYS —— 漏了 → PUT 直接 400；
//   3. components/PrefsDialog.tsx 的 rows + useLayoutEffect —— 漏了 → 设置页看不见 / 首帧闪。
//
// 本文件的断言全部「先剥注释再匹配」：否则「勿加回来」这类说明文字本身就会把
// 断言打红，逼着后来的人去删警告（与 settings-structure / footnote-contrast 同款做法）。
// 另外每个解析 helper 都先断言锚点存在（防空转——indexOf 未命中返回 -1，
// 而 -1 小于任何正数，顺序断言会在目标被删掉时反而通过）。
// ============================================================================

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

function read(rel: string): string {
  return readFileSync(join(projectRoot, rel), 'utf8')
}

/** 剥块注释 + 整行行注释（与 settings-structure 的 code() 一致） */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** 取锚点位置并先断言存在（防空转） */
function pos(src: string, needle: string): number {
  const i = src.indexOf(needle)
  expect(i, `找不到锚点：${needle}`).toBeGreaterThanOrEqual(0)
  return i
}

const PREFS = 'lib/client/prefs.ts'
const ROUTE = 'app/api/prefs/route.ts'
const DIALOG = 'components/PrefsDialog.tsx'

// 从 prefs.ts 的 ALL_KEYS 数组里取出键的「标识符名」（如 LOCATION_KEY）。
function allKeyIdents(): string[] {
  const m = code(PREFS).match(/const ALL_KEYS = \[([^\]]*)\]/)
  expect(m, 'ALL_KEYS 数组未找到').not.toBeNull()
  return m![1].split(',').map((s) => s.trim()).filter(Boolean)
}

// 把标识符名解析成它的字面量值（export const LOCATION_KEY = 'qo-location-enabled'）。
function keyLiteral(ident: string): string {
  const m = code(PREFS).match(new RegExp(`export const ${ident} = '([^']+)'`))
  expect(m, `键常量未找到：${ident}`).not.toBeNull()
  return m![1]
}

// route.ts 的 PREF_KEYS 集合里的字面量
function serverKeys(): string[] {
  const m = code(ROUTE).match(/const PREF_KEYS = new Set\(\[([\s\S]*?)\]\)/)
  expect(m, 'PREF_KEYS 未找到').not.toBeNull()
  return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

describe('偏好键三处同步', () => {
  it('P0 解析自检：ALL_KEYS 与 PREF_KEYS 都能解析出内容（防空转）', () => {
    expect(allKeyIdents().length).toBeGreaterThan(5)
    expect(serverKeys().length).toBeGreaterThan(5)
  })

  it('P1 服务器同步键集合 = ALL_KEYS 集合（漏一个就是隐性 bug）', () => {
    const clientKeys = allKeyIdents().map(keyLiteral).sort()
    const srvKeys = serverKeys().sort()
    // 刻意不进服务器同步的键（值域非 '0'/'1'，或属设备属性）：
    //   qo-offline-cache（缓存是设备属性）、qo-theme / qo-prompt-timing（字符串值）、
    //   qo-export-format（设备习惯，见 ExportView）。
    const LOCAL_ONLY = ['qo-offline-cache', 'qo-theme', 'qo-prompt-timing', 'qo-export-format']
    expect(srvKeys).toEqual(clientKeys.filter((k) => !LOCAL_ONLY.includes(k)))
  })

  it('P2 每个同步键在 PrefsDialog 的 rows 里都有一行（漏了设置页看不见）', () => {
    const dialog = code(DIALOG)
    for (const ident of allKeyIdents()) {
      expect(dialog, `PrefsDialog 缺少 ${ident} 的开关行`).toContain(`key: ${ident},`)
    }
  })

  it('P3 每个同步键都在 useLayoutEffect 里被同步读取（漏了首帧闪默认值）', () => {
    const dialog = code(DIALOG)
    for (const ident of allKeyIdents()) {
      expect(dialog, `PrefsDialog 未在 paint 前读 ${ident}`).toContain(`localStorage.getItem(${ident})`)
    }
  })

  it('P4 本机专属键不得出现在服务器白名单（防「以为同步了其实只在本机」）', () => {
    const srv = serverKeys()
    for (const k of ['qo-offline-cache', 'qo-theme', 'qo-prompt-timing', 'qo-export-format']) {
      expect(srv, `${k} 是设备本地键，不该进 PREF_KEYS`).not.toContain(k)
    }
  })
})

describe('A1 保存音效开关', () => {
  it('A1-1 音效只有一个出口 playSaveSoundIfEnabled，调用点不得直连 playSaveSound', () => {
    // sound.ts 里保留底层 playSaveSound（被 IfEnabled 调用），其余文件一律走 IfEnabled
    for (const f of ['components/DiaryEditor.tsx', 'components/EntryView.tsx']) {
      const src = code(f)
      // 先断言确实有调用（否则下面的「不含」会静默空转）
      expect(src, `${f} 未调用音效入口`).toContain('playSaveSoundIfEnabled()')
      expect(src, `${f} 绕过了偏好直连 playSaveSound`).not.toMatch(/(?<!IfEnabled)\bplaySaveSound\(\)/)
    }
  })

  it('A1-2 sound.ts 的门控函数真的读了偏好', () => {
    const src = code('lib/client/sound.ts')
    const start = pos(src, 'export function playSaveSoundIfEnabled')
    // 用「下一个 export function」作右界，别用 'export function playSaveSound'——
    // 后者会先匹配到 ...IfEnabled 本身（前缀更短），切出空串让断言静默失效。
    const end = src.indexOf('export function', start + 10)
    expect(end, '找不到门控函数的右边界').toBeGreaterThan(start)
    const body = src.slice(start, end)
    expect(body, '门控未读 isSaveSoundEnabled').toContain('isSaveSoundEnabled()')
    expect(body, '门控未在关闭时提前返回').toContain('return')
  })
})

describe('B1 打开次数显示开关', () => {
  it('B1-1 眼睛恒渲染（含 0 次），只由偏好做条件——修「0→1 闪现」', () => {
    const src = code('components/EntryView.tsx')
    expect(src, '渲染条件应只剩偏好开关').toContain('showViews && (')
    // `viewCount > 0 &&` 是布局闪现的根源：图标在计数返回后凭空插入 DOM（2026-10-01 修）
    expect(src, '不得回到「次数 > 0 才显示」').not.toContain('viewCount > 0 &&')
  })

  it('B1-2 关掉显示不等于停止计数：上报逻辑与偏好解耦', () => {
    const src = code('components/EntryView.tsx')
    // bumpEntryViewCount 的调用不得被 showViews 包裹（否则关显示就停止统计）
    const call = pos(src, 'bumpEntryViewCount(entry.id)')
    const around = src.slice(Math.max(0, call - 200), call)
    expect(around, '计数上报不应受 showViews 控制').not.toContain('showViews')
  })
})

describe('B3 热力图显示开关', () => {
  it('B3-1 热力图渲染条件包含偏好判断', () => {
    const src = code('components/DiaryListView.tsx')
    expect(src).toContain('showHeatmap && stats.count > 0')
  })
})

describe('B4 每日提示出现时机', () => {
  it('B4-1 提示渲染走 isPromptVisible（开关 × 时机），不是裸 isPromptEnabled()', () => {
    const src = code('components/DiaryEditor.tsx')
    expect(src).toContain('{isPromptVisible && (')
    // 渲染条件处不得再直接调 isPromptEnabled()
    expect(src, '渲染条件应统一走 isPromptVisible').not.toContain('{isPromptEnabled() && (')
  })

  it('B4-2 isPromptVisible 同时含开关与时机档判断', () => {
    const src = code('components/DiaryEditor.tsx')
    const i = pos(src, 'const isPromptVisible')
    const line = src.slice(i, src.indexOf('\n', i))
    expect(line).toContain('isPromptEnabled()')
    expect(line).toContain('promptTiming')
  })

  it('B4-3 上报时机与「是否真的显示」对齐（否则会出现「没显示却 +1」）', () => {
    const src = code('components/DiaryEditor.tsx')
    const i = pos(src, 'reportPromptShown(promptIdx)')
    const before = src.slice(Math.max(0, i - 120), i)
    expect(before, '上报前应先判断 isPromptVisible').toContain('if (isPromptVisible)')
    // 依赖数组必须含 isPromptVisible，否则正文从空变非空时不重算
    const after = src.slice(i, i + 120)
    expect(after).toContain('isPromptVisible]')
  })
})

describe('A2 主题外观', () => {
  it('A2-1 prefs.ts 提供主题三档与首帧应用函数', () => {
    const src = code(PREFS)
    expect(src).toContain("THEME_VALUES = ['system', 'light', 'dark']")
    expect(src).toContain('export function applyTheme')
    expect(src).toContain("el.classList.toggle('theme-light'")
  })

  it('A2-2 root layout 有首帧内联脚本（否则会闪一下系统色）', () => {
    const src = code('app/layout.tsx')
    expect(src).toContain('qo-theme')
    expect(src, '必须在 <head> 内联同步执行').toContain('dangerouslySetInnerHTML')
    // 脚本要落在 head 里（paint 之前）
    expect(pos(src, '<head>')).toBeLessThan(pos(src, 'themeInitScript }'))
  })

  it('A2-3 globals.css 有强制浅色的反向压制（否则「浅色」档在深色系统下无效）', () => {
    const src = code('app/globals.css')
    expect(src).toContain('.theme-light {')
    expect(src, '需要逐类覆盖 dark: 工具类').toContain('.theme-light .dark\\:bg-neutral-800')
  })

  it('A2-4 压制表覆盖源码里实际用到的全部 dark: 类（新增类忘了补 → 这里红）', () => {
    const css = read('app/globals.css')
    // 收集源码里实际出现的 dark: 工具类（排除注释，且只看真实 class 串）
    const found = new Set<string>()
    const walk = (dir: string) => {
      for (const e of readdirSync(join(projectRoot, dir), { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'Temp') continue
        const rel = `${dir}/${e.name}`
        if (e.isDirectory()) walk(rel)
        else if (/\.(tsx|ts)$/.test(e.name)) {
          const src = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
          for (const m of src.matchAll(/dark:([A-Za-z0-9:_\[\]/.%-]+)/g)) found.add(m[1])
        }
      }
    }
    for (const f of ['components', 'app', 'lib']) walk(f)
    expect(found.size, '未扫到任何 dark: 类，解析失败').toBeGreaterThan(20)

    // 压制表对每个 dark: 类都要有一条 `.theme-light .dark\:<转义后的类名>` 规则。
    // 注意：断言必须锚定「.theme-light 」前缀——只查 `.dark\:xxx` 会命中 Tailwind
    // 自己生成的那条裸类规则，从而永远通过（真实踩到的空转）。
    // Tailwind 的 CSS 转义规则：类名里**每个**冒号、斜杠、点都插反斜杠
    // （`.dark\:placeholder\:text-neutral-400`、`.dark\:bg-neutral-900\/40`）。
    const cssClass = (cls: string) => `.dark\\:${cls.replace(/[:/.[\]%]/g, (c) => `\\${c}`)}`
    const missing = [...found].filter((cls) => !css.includes(`.theme-light ${cssClass(cls)}`))
    expect(missing, `以下 dark: 类未被 .theme-light 压制：${missing.join(', ')}`).toEqual([])
  })
})

describe('B2 记忆导出格式', () => {
  it('B2-1 导出页用 localStorage 记住格式，且默认档是 json-zip', () => {
    const src = code('components/ExportView.tsx')
    expect(src).toContain("EXPORT_FORMAT_KEY = 'qo-export-format'")
    expect(pos(src, "return 'json-zip'")).toBeGreaterThan(0)
    // 选中态从记忆读，而不是写死
    expect(src).toContain('useState<ExportFormat>(readExportFormat)')
  })

  it('B2-2 切换格式时写回记忆', () => {
    const src = code('components/ExportView.tsx')
    const i = pos(src, 'function pickFormat')
    expect(src.slice(i, i + 300)).toContain('localStorage.setItem(EXPORT_FORMAT_KEY')
  })
})
