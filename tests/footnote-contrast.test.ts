import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 回归守卫：小字（版本号 / 版权 / 诊断码）不得再用「反向」配色对
// text-neutral-300 dark:text-neutral-600。
//
// 背景（真实事故）：登录页的版本页脚在 iPhone Safari 与 PWA 里「不显示」，其中一环就是
// 这对 token 方向是反的——浅色模式画的是给深色底准备的浅灰（#d4d4d4 on #fff ≈ 1.5:1），
// 深色模式画的是给浅色底准备的深灰（#525252 on #0a0a0a ≈ 2.5:1）。10px 小字在这个对比度下
// 几乎不可见；桌面显示器离得近、屏幕大，勉强还能看清，于是问题只在手机上暴露。
// 现在统一用 text-neutral-500 dark:text-neutral-400（≈4.7:1 / ≈7.4:1，过 WCAG AA）。
//
// 以后谁再写回这对（或把某一端改回 300/600），这个测试会直接失败并指出文件。

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectSourceFiles(full))
    else if (/\.(tsx|ts|css)$/.test(entry.name)) out.push(full)
  }
  return out
}

const BANNED = 'text-neutral-300 dark:text-neutral-600'

// 只算「真的写进了 class 属性」的命中：注释里为了说明问题会引用这对字符串，
// 那是文档不是用法（判据：同一行里同时出现 class/className）。
function classUsages(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => line.includes(BANNED) && /class/i.test(line))
    .map(({ line, no }) => `${line.trim()}  (第 ${no} 行)`)
}

describe('小字配色方向', () => {
  const files = [...collectSourceFiles(join(projectRoot, 'app')), ...collectSourceFiles(join(projectRoot, 'components'))]

  it('app/ 与 components/ 下不再出现反向配色对', () => {
    const offenders = files.flatMap((f) => classUsages(f).map((u) => `${f.slice(projectRoot.length)}: ${u}`))
    expect(offenders).toEqual([])
  })

  it('版本号 / 版权 / 诊断码用的是 AA 级配色对', () => {
    const targets = [
      'app/login/page.tsx', // 版本页脚
      'components/AboutDialog.tsx', // 版权行
      'app/error.tsx', // 诊断码
    ]
    const missing = targets.filter((rel) => !readFileSync(join(projectRoot, rel), 'utf8').includes('text-neutral-500 dark:text-neutral-400'))
    expect(missing).toEqual([])
  })
})
