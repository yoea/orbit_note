import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================================
// 「导出与导入」术语守卫（2026-09-30）
//
// 背景：同一个功能曾有三套叫法——设置项与页标题叫「备份与恢复」、页内分段与按钮叫
// 「导出 / 导入」、格式清单里又叫「JSON 备份包」。用户进设置页点「备份与恢复」，
// 落地页里一个「备份」字都看不到，反而满屏「导出」。语义相近、表述不一致，读完要愣一下。
//
// 定下的规矩（用户拍板）：**统一为「导出 / 导入」**。理由是机制上唯一准确——
//   · CSV 明确「不能导回本应用」，叫"备份"是错的；
//   · 从 Day One / Journey 迁入属于「导入」，不是「恢复」；
//   · 三条流出、两条流入，全都落在「导出 / 导入」这个词根里。
//
// 这个文件钉住"改动后不许退回去"，而不只是在改动的当下正确。
// 断言前剥离注释：否则「不要再叫备份包」这类说明文字自己就会把断言打红
// （settings-structure.test.ts / footnote-contrast.test.ts 同款做法）。
// ============================================================================

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

function code(rel: string): string {
  return readFileSync(join(projectRoot, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** 这个功能的全部界面文件（入口 + 页壳 + 两个面板 + 导入编排里的用户可见报错） */
const FILES = [
  'components/SettingsView.tsx',
  'components/BackupRestoreView.tsx',
  'components/ExportView.tsx',
  'components/ImportView.tsx',
  'lib/client/import.ts',
]

describe('导出与导入 · 术语统一', () => {
  it('T0 解析自检：四个文件都读到了（防空转）', () => {
    for (const f of FILES) expect(code(f).length, `${f} 读不到内容`).toBeGreaterThan(500)
  })

  it('T1 功能名在入口、页标题、读屏标签三处完全一致', () => {
    expect(code('components/SettingsView.tsx')).toContain('>导出与导入</p>')
    const page = code('components/BackupRestoreView.tsx')
    expect(page).toContain('text-lg font-semibold">导出与导入</h1>')
    expect(page).toContain('aria-label="导出与导入"')
  })

  it('T2 页内分段与功能名同词根（导出 / 导入），不是另一套词', () => {
    // 去掉空白再比对，避免把缩进写死在断言里
    const page = code('components/BackupRestoreView.tsx').replace(/\s+/g, '')
    expect(page).toContain('>导出</button>')
    expect(page).toContain('>导入</button>')
  })

  it('T3 旧词已从全流程清除（备份与恢复 / 备份包 / 备份文件）', () => {
    for (const f of FILES) {
      const src = code(f)
      for (const dead of ['备份与恢复', '备份包', '备份文件']) {
        expect(src, `${f} 里还有旧术语「${dead}」`).not.toContain(dead)
      }
    }
  })

  it('T4 两个面板的按钮与提示都落在同一组动词上', () => {
    const out = code('components/ExportView.tsx')
    for (const s of ['导出格式', '导出文件', '下载导出的文件', '已导出', '导出失败']) {
      expect(out, `导出面板缺少文案「${s}」`).toContain(s)
    }
    const into = code('components/ImportView.tsx')
    for (const s of ['可导入', '导入完成', '导入失败', '选择文件']) {
      expect(into, `导入面板缺少文案「${s}」`).toContain(s)
    }
  })

  it('T5 设置项的副标题与标题同源（描述的是"导出 / 导入"，不是"备份"）', () => {
    // 两者必须**相邻**：只断言「都在文件里」会漏掉"标题改回来了、副标题没跟着改"这种情况
    expect(code('components/SettingsView.tsx')).toMatch(
      />导出与导入<\/p>\s*<p className="[^"]*">把日记导出为文件，或从文件导入<\/p>/,
    )
  })

  it('T6 旧路由仍指向合并后的入口（改名不得连带改路由）', () => {
    // 路由名 /settings/backup 保持不动：换它有真实代价（书签、浏览器历史、已装的 PWA），
    // 收益只是"看起来一致"。术语一致性的战场在**界面文案**，不在 URL。
    const cfg = readFileSync(join(projectRoot, 'next.config.ts'), 'utf8')
    expect(cfg).toMatch(/source:\s*'\/settings\/export'[^}]*destination:\s*'\/settings\/backup'/)
    expect(cfg).toMatch(/source:\s*'\/settings\/import'[^}]*destination:\s*'\/settings\/backup'/)
  })
})
