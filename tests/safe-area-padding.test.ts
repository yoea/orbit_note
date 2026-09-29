import { describe, expect, it } from 'vitest'
import { classTokens, projectClassAttrs } from './class-attrs'

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
      'components/ExportView.tsx',
      'components/DiaryListView.tsx',
      'components/DiaryEditor.tsx',
      'components/EntryView.tsx',
    ]
    const missing = targets.filter((rel) => !tokensOf(rel).includes('pb-4'))
    expect(missing).toEqual([])
  })

  it('G4 弹窗底部操作按钮统一为 py-3.5', () => {
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
