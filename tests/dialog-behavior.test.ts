// 守卫：弹窗统一行为（Esc 栈 / Tab 循环 / 焦点归还）与桌面端无障碍基线。
//
// 背景（2026-10-29 用户要求）：
//   · 「所有模态框统一增加 ESC 关闭，覆盖关于/偏好设置/恢复密钥/通行密钥/昵称等，
//     排查其他模态框避免遗漏；多层叠加时一次只关最上层。」
//   · 「桌面端无障碍适配：键盘可完整操作、焦点清晰、无键盘陷阱、读屏可识别、
//     不依赖颜色单独传达信息、满足基本对比度。」
//
// ★ 为什么 Esc 不做成「每个弹窗各挂一个 window keydown」：
//   那样叠层时（通行密钥弹窗里再开确认框）一次 Esc 会把**所有**监听器都触发 ⇒ 多层齐关。
//   现在统一到 lib/client/dialog.ts：window 上只有**一个**监听 + 一个栈，
//   Esc 只调栈顶（= 最上层）。本文件把这条钉死。
//
// 解析走 tests/class-attrs.ts 的 stripComments（注释里为说明问题引用的写法不算用法）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot, stripComments } from './class-attrs'

function code(rel: string): string {
  return stripComments(readFileSync(join(projectRoot, rel), 'utf8'))
}

/** 必须支持 Esc 的弹层（每个都是独立成层、可被用户直接关掉的模态） */
const ESC_DIALOGS = [
  'components/ConfirmDialog.tsx',
  'components/InputConfirmDialog.tsx',
  'components/Popconfirm.tsx',
  'components/BackupSheet.tsx',
  'components/AboutDialog.tsx',
  'components/HiddenPanel.tsx',
  'components/PasskeysDialog.tsx',
  'components/NameEditDialog.tsx',
  'components/RecoveryRegenerateDialog.tsx',
  'components/PrefsDialog.tsx',
  'components/SearchDialog.tsx',
  'components/WipeDataAction.tsx',
]

describe('弹窗统一行为（Esc 栈 + 焦点管理）', () => {
  it('D1 全局只有一个 keydown 监听（多监听 ⇒ 一次 Esc 关掉多层）', () => {
    const src = code('lib/client/dialog.ts')
    const listeners = src.match(/window\.addEventListener\('keydown'/g) ?? []
    expect(listeners.length, '弹窗行为模块里只能有一个 keydown 监听').toBe(1)
    expect(src, '没有退订 keydown（会泄漏）').toContain("window.removeEventListener('keydown'")
  })

  it('D2 Esc 只作用于栈顶（最上层），不是全部', () => {
    const src = code('lib/client/dialog.ts')
    expect(src, '没有「取栈顶」这一步').toContain('stack[stack.length - 1]')
    // 反面：不得对整个栈做遍历式关闭
    expect(src, '不能遍历整个栈来关闭（那是一次关多层）').not.toMatch(/for\s*\([^)]*\)\s*\{[^}]*getOnEsc\(\)/)
    expect(src, 'Esc 没有真的触发关闭').toContain('top.getOnEsc()')
  })

  it('D3 栈是后进先出（弹窗挂载即入栈、卸载即出栈）', () => {
    const src = code('lib/client/dialog.ts')
    expect(src, '没有入栈').toContain('stack.push(entry)')
    expect(src, '没有出栈').toContain('stack.splice(i, 1)')
  })

  it('D4 全部弹层都接入了统一 hook', () => {
    for (const rel of ESC_DIALOGS) {
      const src = code(rel)
      // ★ 必须断言**调用**而不是「这个名字出现过」——import 行里也有它，
      //   断言标识符会把「只 import 没调用」判成通过（2026-10-29 非空转验证实测）。
      expect(src, `${rel} 没有接入 useDialogBehavior（Esc 行为不统一）`).toContain('useDialogBehavior(')
      // 反面：组件里不得再自己挂 window keydown（两套监听 ⇒ 一次 Esc 关多层）
      expect(src, `${rel} 又自己挂了 window keydown（与全局 Esc 栈重复）`).not.toContain(
        "window.addEventListener('keydown'",
      )
    }
  })

  it('D5 焦点管理三件套：初始聚焦 / Tab 循环 / 关闭归还', () => {
    const src = code('lib/client/dialog.ts')
    expect(src, '没有初始聚焦').toContain('FOCUSABLE_SELECTOR')
    expect(src, '没有 Tab 循环').toContain("e.key === 'Tab'")
    expect(src, '没有归还焦点').toContain('prev.focus()')
  })

  it('D6 弹窗语义：role + aria-modal + 可读名称', () => {
    for (const rel of ESC_DIALOGS) {
      const src = code(rel)
      if (rel === 'components/Popconfirm.tsx') continue // 气泡确认已有 role/aria-modal/aria-label
      const hasRole = src.includes('role="dialog"') || src.includes('role="alertdialog"')
      expect(hasRole, `${rel} 缺 role="dialog" / role="alertdialog"`).toBe(true)
      expect(src, `${rel} 缺 aria-modal="true"`).toContain('aria-modal="true"')
    }
  })

  it('D7 隐藏面板的 Esc 走带闸门的 requestClose（不能绕过 1 秒防误触）', () => {
    const src = code('components/HiddenPanel.tsx')
    expect(src, '隐藏面板的 Esc 没有走 requestClose').toContain('useDialogBehavior(cardRef, requestClose)')
    expect(src, 'requestClose 里没有 1 秒闸门').toContain('CLOSE_GUARD_MS')
  })

  it('D8 就地改名输入框的 Esc 只放弃改名，不关弹窗', () => {
    const src = code('components/PasskeysDialog.tsx')
    const at = src.indexOf('onNameKeyDown')
    expect(at, '找不到 onNameKeyDown').toBeGreaterThan(-1)
    const body = src.slice(at, at + 600)
    expect(body, '改名输入框的 Esc 没有拦下冒泡（会连弹窗一起关）').toContain('stopPropagation')
    expect(body, '改名输入框的 Esc 没有放弃改名').toContain('cancelRename()')
  })
})

describe('桌面端无障碍基线', () => {
  it('A1 全局键盘焦点可见 + 尊重「减少动态效果」', () => {
    const css = code('app/globals.css')
    // ★ 断到「按钮那条规则」本体：光断 ':focus-visible' 会被 ':focus-visible-disabled' 兜住，
    //   断 ':focus-visible {' 又会被另外两条（input / textarea）兜住 ⇒ 用正则钉住整条规则。
    expect(css, '没有全局 :focus-visible 焦点样式（键盘用户看不到焦点在哪）').toMatch(
      /:focus-visible\s*\{\s*outline: 2px solid #8b5cf6;/,
    )
    expect(css, '没有 outline（焦点环要真的画出来）').toContain('outline: 2px solid')
    expect(css, '没有 prefers-reduced-motion（前庭敏感用户）').toContain('prefers-reduced-motion: reduce')

    // ★ 分层（2026-10-29 用户两次反馈：「写页输入框突然多了个紫色边框」
    //   +「输入框 / 下拉框 1px 描边也去掉」）：
    //   品牌紫只留给按钮 / 链接 / 开关 / 标签页；
    //   **输入框 / 下拉 / 正文文本域一律不画描边** —— 它们的聚焦指示由自身既有样式承担
    //   （有边框的走 focus:border-neutral-400；无边框搜索框走 focus-within 底色；
    //   正文文本域里光标本身就是焦点指示）。
    const focusRules = css.split('}').filter((r) => r.includes(':focus-visible'))
    const purpleOnInput = focusRules.some((r) => /input|select/.test(r) && r.includes('#8b5cf6'))
    expect(purpleOnInput, '输入框仍在用品牌紫焦点环（写页正文会突兀）').toBe(false)
    // ★ 逐条看：凡涉及输入框 / 下拉 / 文本域的焦点规则，outline 的值**必须**是 none。
    //   （早先写成 /outline:\s*(?!none)/ 会被正则的贪婪回溯坑掉：\s* 退化成空匹配后
    //     lookahead 看到的是空格而不是 "none" ⇒ 规则照样命中 ⇒ 假红。）
    const inputRules = focusRules.filter((r) => /input|select|textarea/.test(r))
    expect(inputRules.length, '没有针对输入框 / 下拉 / 文本域的焦点规则').toBeGreaterThan(0)
    for (const r of inputRules) {
      expect(r, '输入框 / 下拉 / 文本域的焦点规则必须是 outline: none').toMatch(/outline:\s*none/)
    }
    // 唯一无边框的输入框是搜索框：靠底色加深提示焦点（不是描边）
    expect(code('components/SearchDialog.tsx'), '无边框搜索框没有聚焦提示').toContain('focus-within:bg-neutral-200')
  })

  it('A2 输入框都要有可读名称（placeholder 不是标签）', () => {
    const cases: [string, string][] = [
      ['components/AutoTextarea.tsx', 'aria-label="日记正文"'],
      ['components/EntryView.tsx', 'aria-label="日记正文"'],
      ['components/SearchDialog.tsx', 'aria-label="搜索日记内容"'],
      ['components/NameEditDialog.tsx', 'aria-label="新名字"'],
      ['components/RecoveryRegenerateDialog.tsx', 'aria-label="当前恢复密钥"'],
      ['components/ExportView.tsx', 'aria-label="恢复密钥"'],
      ['components/InputConfirmDialog.tsx', 'aria-label={`输入「${expected}」确认`}'],
    ]
    for (const [rel, needle] of cases) {
      expect(code(rel), `${rel} 的输入框没有可读名称`).toContain(needle)
    }
  })

  it('A3 错误提示要能被读屏播报（role="alert"）', () => {
    // ★ 钉到**具体那一句错误提示**：只断言「文件里出现过 role="alert"」会被
    //   同一文件里的其它 role="alert" 兜住（2026-10-29 非空转验证实测）。
    const cases: [string, string][] = [
      ['components/SearchDialog.tsx', '<p role="alert" className="text-sm text-red-500">{error}</p>'],
      ['components/UnlockPrompt.tsx', '{error && <p role="alert" className="mt-3 text-center text-sm text-red-500">{error}</p>}'],
      ['components/PasskeysDialog.tsx', '{error && <p role="alert" className="mt-3 text-center text-sm text-red-500">{error}</p>}'],
      ['components/ImportView.tsx', '{error && <p role="alert" className="mt-3 text-center text-sm text-red-500">{error}</p>}'],
      ['components/AddPasskeyPanel.tsx', '{error && <p role="alert" className="text-center text-sm text-red-500">{error}</p>}'],
      ['components/ExportView.tsx', '{error && <p role="alert" className="text-center text-sm text-red-500">{error}</p>}'],
      ['components/EntryView.tsx', '{error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}'],
      ['components/NameEditDialog.tsx', '{error && <p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}'],
      ['components/RecoveryRegenerateDialog.tsx', '{error && <p role="alert" className="mt-3 text-center text-sm text-red-500">{error}</p>}'],
    ]
    for (const [rel, needle] of cases) {
      expect(code(rel), `${rel} 的错误提示没有 role="alert"`).toContain(needle)
    }
  })

  it('A4 不依赖颜色单独传达状态：收藏 chip / 偏好开关 / 热力图 / 进度条', () => {
    const search = code('components/SearchDialog.tsx')
    expect(search, '筛选 chip 没有 aria-pressed（选中态只靠颜色）').toContain('aria-pressed={active}')
    expect(search, '筛选 chip 没有 aria-expanded（展开面板不可读）').toContain('aria-expanded={expanded}')

    const prefs = code('components/PrefsDialog.tsx')
    expect(prefs, '偏好开关没有可读名称（读屏只念「开关，开」）').toContain('aria-label={label}')

    const heat = code('components/ContributionHeatmap.tsx')
    expect(heat, '热力图没有 role="img"（纯色阶，读屏读不到）').toContain('role="img"')
    expect(heat, '热力图没有文字摘要').toContain('heatmapSummary')

    const imp = code('components/ImportView.tsx')
    expect(imp, '导入进度条没有 role="progressbar"').toContain('role="progressbar"')
    expect(imp, '导入进度条没有 aria-valuenow').toContain('aria-valuenow=')
  })

  it('A5 离线禁用态要能被读屏识别（不能只靠 opacity）', () => {
    const settings = code('components/SettingsView.tsx')
    expect(settings, '设置页的离线禁用按钮没有 aria-disabled').toContain('aria-disabled={offline}')
    const card = code('components/ProfileCard.tsx')
    expect(card, '头像卡没有 aria-disabled').toContain('aria-disabled={disabled}')
  })
})
