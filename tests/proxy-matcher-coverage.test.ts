import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 回归守卫：proxy.ts 的 matcher 必须覆盖 app/ 下所有页面路由。
//
// 背景（真实事故）：/history → /diary 路由改名时只改了页面，漏了 proxy.ts 的 matcher，
// 导致 /diary 既拿不到任何安全头（CSP / X-Frame-Options / nosniff / Referrer-Policy /
// Permissions-Policy），也失去未登录重定向。安全审计文档声称「所有页面响应附加安全头」，
// 该不变量被破坏且没有任何测试发现。
//
// 以后新增页面路由若忘记登记 matcher，这个测试会直接失败并列出漏掉的路径。

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

// 递归收集 app/ 下的 page.tsx → 路由路径（排除 api/ 与 _ 开头的私有目录）
function collectPageRoutes(dir: string, prefix = ''): string[] {
  const routes: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'api' || entry.name.startsWith('_')) continue
    if (entry.isDirectory()) {
      routes.push(...collectPageRoutes(join(dir, entry.name), `${prefix}/${entry.name}`))
    } else if (entry.name === 'page.tsx') {
      routes.push(prefix === '' ? '/' : prefix)
    }
  }
  return routes
}

function matcherSources(): string[] {
  const src = readFileSync(join(projectRoot, 'proxy.ts'), 'utf8')
  return [...src.matchAll(/source:\s*'([^']+)'/g)].map((m) => m[1])
}

describe('proxy matcher 覆盖率守卫', () => {
  const routes = collectPageRoutes(join(projectRoot, 'app'))
  const sources = matcherSources()

  it('能识别到页面路由（防止断言空集导致假通过）', () => {
    expect(routes.length).toBeGreaterThan(5)
    expect(routes).toContain('/')
    expect(routes).toContain('/diary')
    expect(routes).toContain('/settings')
  })

  it('每个页面路由都被某个 matcher 覆盖', () => {
    const uncovered = routes.filter((route) =>
      !sources.some((s) => {
        // '/entry/:path*' → '/entry'；根路径 '/' 单独处理（否则 base 为空串会匹配所有路由）
        const base = s === '/' ? '/' : s.replace(/\/:path\*$/, '')
        if (route === base) return true
        return base !== '/' && route.startsWith(`${base}/`)
      }),
    )
    expect(uncovered, `以下页面路由缺少 proxy matcher（会丢失安全头与未登录重定向）：${uncovered.join(', ')}`).toEqual([])
  })
})
