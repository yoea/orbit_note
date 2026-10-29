// 守卫：归档页（阶段 2，2026-10-29）
//
// 这个页面唯一的「结构性风险」不是排版，而是**照抄列表页**：
// 列表页的 fetchPage 里有一句 `pruneCachedEntries(...)`，它的语义是
// 「服务器全量清单里没有的 ⇒ 已删除，从本地缓存清掉」。归档页拿到的是**全表的子集**
// （archived=only），照抄那一行会把所有未归档条目当「已删除」清掉 ——
// 表现为「去了趟归档页，断网后列表全空了」，而且零报错、零日志。
// B3 就是钉这一条（反向断言：文件里根本不许出现这个调用）。
//
// 另外三条（B4/B5/B6）钉的是「闭环」：能从设置进得去、能从归档点开一篇、
// 点开之后返回能回到归档页。缺一条，这个功能就是个单向黑洞。
//
// 非空转验证：Temp/nonvacuous_archive_page.py
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot } from './class-attrs'

const PAGE = 'app/(app)/settings/archive/page.tsx'
const VIEW = 'components/ArchiveListView.tsx'
const SETTINGS = 'components/SettingsView.tsx'
const ENTRY_VIEW = 'components/EntryView.tsx'
const ARCHIVE_LIB = 'lib/client/archive.ts'
const PROXY = 'proxy.ts'
const PROXY_GUARD = 'lib/server/proxy-guard.ts'

function code(rel: string): string {
  return readFileSync(join(projectRoot, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

/** 源码级切片：两端都先断言存在（indexOf 未命中返回 -1，直接用会让顺序断言静默空转） */
function slice(rel: string, from: string, to: string): string {
  const src = code(rel)
  const a = src.indexOf(from)
  expect(a, `${rel} 里找不到「${from}」`).toBeGreaterThanOrEqual(0)
  const b = src.indexOf(to, a + from.length)
  expect(b, `${rel} 里找不到切片右界「${to}」`).toBeGreaterThan(a)
  return src.slice(a, b)
}

describe('AR · 归档页（/settings/archive）', () => {
  it('AR0 解析自检：四个文件都读到了，关键锚齐全（防断言空转）', () => {
    for (const [rel, needle] of [
      [PAGE, 'ArchiveListView'],
      [VIEW, 'archived=only'],
      [SETTINGS, '/settings/archive'],
      [ARCHIVE_LIB, 'daysAgoLabel'],
    ] as const) {
      const src = code(rel)
      expect(src.length, `${rel} 读不到内容`).toBeGreaterThan(100)
      expect(src, `${rel} 里找不到「${needle}」`).toContain(needle)
    }
  })

  it('AR1 路由页只是薄壳（守卫统一在 (app)/layout，页面自己不写守卫）', () => {
    const src = code(PAGE)
    expect(src, '路由页没有渲染 ArchiveListView').toContain('<ArchiveListView />')
    // 页面自身写守卫 = 与 (app)/layout 的解锁逻辑重复，且两处会漂移
    expect(src, '路由页自己写了守卫（useRequireUnlock 应只在 (app)/layout 里）').not.toContain('useRequireUnlock')
  })

  it('AR2 只拉已归档那一档（archived=only），不是本地过滤全表', () => {
    const src = code(VIEW)
    expect(src, '归档页没有按 archived=only 请求 —— 会把未归档的条目也拉下来').toContain('archived=only')
    // 拉全表再本地筛 = 每次进归档页都要解密全部日记（几百条时明显卡）
    expect(src, '归档页似乎在拉全表（archived=all）再本地筛').not.toContain('archived=all')
  })

  it('AR3 ★ 绝不 prune 本地缓存（prune 只认全量清单，这里是子集）', () => {
    // 反向断言：整个文件里不许出现这个调用（注释已被剥掉，不会误伤）
    const src = code(VIEW)
    expect(src, '归档页调用了 pruneCachedEntries —— 它会把所有未归档条目当「已删除」从缓存清掉，断网后列表全空')
      .not.toContain('pruneCachedEntries')
    // 但「写缓存」必须在：列表里出现过的，本地必须已有密文（离线可读性）
    expect(src, '归档页没有把拉到的条目写进本地密文缓存（离线就点不开了）').toContain('await cacheEntriesPage(')
  })

  it('AR4 点开一条必须带上 from=archive（否则详情页不知道从哪来）', () => {
    const src = code(VIEW)
    expect(src, '归档页的条目链接没带 ?from=archive').toMatch(/href=\{`\/entry\/\$\{item\.id\}\?from=archive`\}/)
  })

  it('AR5 设置页有「已归档」入口，指向归档页', () => {
    const src = code(SETTINGS)
    expect(src, '设置页没有通往归档页的入口').toMatch(/href="\/settings\/archive"/)
    // 入口的可见文字必须是「已归档」——只改 href 不留标签等于藏起来了
    const block = slice(SETTINGS, 'href="/settings/archive"', '</Link>')
    expect(block, '归档入口的标题不是「已归档」').toContain('已归档')
    // 离线**不**禁用：归档列表有本地缓存兜底，禁掉会让离线用户以为功能没了
    expect(block, '归档入口在离线时被禁用了（它只读本地缓存，不该禁）').not.toContain('disabledClass')
  })

  it('AR6 详情页的返回箭头 / 删除后跳转都用 backHref，不再写死 /diary', () => {
    const src = code(ENTRY_VIEW)
    expect(src, '详情页返回箭头还是写死 /diary —— 从归档页点开就回不去了').toContain('href={backHref}')
    expect(src, '详情页没有识别 from=archive').toMatch(/get\('from'\) === 'archive'/)
    const replaced = src.match(/router\.replace\(backHref\)/g) ?? []
    expect(replaced.length, `删除后跳转有 ${replaced.length} 处用了 backHref，应为 2 处（未同步笔记 / 服务器删除）`).toBe(2)
  })

  it('AR7 行内显示「归档于 X 天前」，天数按自然日算（不是 24 小时差）', () => {
    expect(code(VIEW), '归档页没显示「归档于」').toContain('归档于')
    expect(code(VIEW), '归档页没走 daysAgoLabel').toContain('daysAgoLabel')
    const lib = code(ARCHIVE_LIB)
    // 按自然日 = 把两侧都归零到当天 0 点再比；用时间戳直接相减是 24 小时差
    expect(lib, 'daysAgoLabel 没有按自然日归零（会显示成 24 小时差）').toContain('getFullYear()')
    expect(lib, 'daysAgoLabel 缺 round（夏令时那天 floor 会把「昨天」算成「今天」）').toContain('Math.round')
  })

  it('AR8 空态区分在线/离线（离线时不能让人以为归档丢了）', () => {
    const src = code(VIEW)
    expect(src, '归档页没有空态文案').toContain('还没有归档的日记')
    expect(src, '空态没有区分离线（离线只显示本机缓存，必须说明）').toContain('useOffline')
  })

  it('AR9 新路由已被 proxy 覆盖（matcher + protectedPaths 都不用改）', () => {
    // 本页放在 /settings/ 子目录下 ⇒ 天然被这两条覆盖。
    // 断言覆盖仍然成立，防止以后有人把 /settings/:path* 收窄成只匹配 /settings。
    expect(code(PROXY), 'proxy matcher 不再覆盖 /settings 子路径').toContain("'/settings/:path*'")
    expect(code(PROXY_GUARD), 'protectedPaths 里没有 /settings（未登录可直接访问归档页）').toContain("'/settings'")
  })
})
