// 守卫：详情页「打不开一篇笔记」时**必须有明确说明**——不许再静默跳走。
//
// 背景（2026-09-30 用户反馈「离线模式偶尔点击列表中的部分笔记无反应、无法查看」）：
// 原来的加载逻辑里有一条致命分支：
//
//     if (!loaded) { router.replace('/diary'); return }
//
// 也就是「网络不可达 + 本地也没有副本」时**静默跳回列表**。用户看到的就是「点了没反应」，
// 而服务端日志里什么都没有、客户端也不留痕 ⇒ 线上无法归因（这才是它最糟的地方）。
//
// 现在数据来源判定收敛成纯函数 resolveEntryLoad（五情形真值表，L1），
// 两种「打不开」各自渲染说明页 + 诊断码（L2/L3），并加了渲染兜底（L4）。
//
// 关于「是不是 markdown 的锅」（用户提出的怀疑方向）——见 L5：离线读不到与正文格式无关，
// 数据链路是「按 id 从本地缓存取密文 → 内存里解密 → 渲染」，格式只在最后一步参与。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot, stripComments } from './class-attrs'
import { resolveEntryLoad } from '@/lib/client/offline'

function code(rel: string): string {
  return stripComments(readFileSync(join(projectRoot, rel), 'utf8'))
}

describe('L · 详情页数据来源判定（resolveEntryLoad）', () => {
  it('L1 真值表：五种情形各自有名字，不留「没人处理」的组合', () => {
    // 服务器 200：永远以服务器为准（哪怕本地队列里也有）
    expect(resolveEntryLoad({ serverStatus: 200, hasQueued: true, hasCached: true })).toEqual({ kind: 'server' })
    expect(resolveEntryLoad({ serverStatus: 200, hasQueued: false, hasCached: false })).toEqual({ kind: 'server' })

    // 服务器明确没有这条：优先信队列（服务器没这条 ⇒ 它就是「未同步」那批），再退缓存，
    // 两者都没有才是「真的不在了」
    expect(resolveEntryLoad({ serverStatus: 404, hasQueued: true, hasCached: false })).toEqual({ kind: 'local-queue' })
    expect(resolveEntryLoad({ serverStatus: 404, hasQueued: false, hasCached: true })).toEqual({ kind: 'local-cache' })
    expect(resolveEntryLoad({ serverStatus: 404, hasQueued: false, hasCached: false })).toEqual({ kind: 'deleted' })

    // 网络不可达：优先信缓存（服务器那份本来就拿不到），再退队列；
    // 两者都没有 = 这篇还没缓存到本机（★ 就是原来静默跳走的那一种）
    expect(resolveEntryLoad({ serverStatus: null, hasQueued: false, hasCached: true })).toEqual({ kind: 'local-cache' })
    expect(resolveEntryLoad({ serverStatus: null, hasQueued: true, hasCached: false })).toEqual({ kind: 'local-queue' })
    expect(resolveEntryLoad({ serverStatus: null, hasQueued: false, hasCached: false })).toEqual({ kind: 'offline-missing' })

    // 其它服务器错误（401/500…）→ 加载失败，不伪装成「不在了」
    expect(resolveEntryLoad({ serverStatus: 500, hasQueued: true, hasCached: true })).toEqual({ kind: 'error' })
    expect(resolveEntryLoad({ serverStatus: 401, hasQueued: false, hasCached: true })).toEqual({ kind: 'error' })
  })

  it('L1b 「打不开」的两种原因必须可区分（一个是可自愈的，一个不可逆）', () => {
    const gone = resolveEntryLoad({ serverStatus: 404, hasQueued: false, hasCached: false })
    const nocache = resolveEntryLoad({ serverStatus: null, hasQueued: false, hasCached: false })
    expect(gone.kind).not.toBe(nocache.kind)
  })
})

describe('L · 详情页不再静默跳走', () => {
  const FILE = 'components/EntryView.tsx'

  it('L2 那条静默分支不许回来', () => {
    const src = code(FILE)
    expect(
      src,
      '又出现了「本地取不到就 router.replace(\'/diary\')」——用户只会看到「点了没反应」，' +
      '既没有报错也没有诊断，线上无法归因。必须走 resolveEntryLoad 渲染说明页。',
    ).not.toContain("!loaded) { router.replace('/diary')")
    expect(src, '详情页没有使用 resolveEntryLoad（判定逻辑又散回组件里了）').toContain('resolveEntryLoad')
  })

  it('L3 两种「打不开」各自有文案与诊断码', () => {
    const src = code(FILE)
    for (const needle of ['这篇日记不在了', '这篇还没缓存到本机', '诊断', 'notfound', 'nocache']) {
      expect(src, `详情页缺少「${needle}」`).toContain(needle)
    }
  })

  it('L4 Markdown 渲染包了兜底边界（渲染器异常也要能读到原文）', () => {
    const src = code(FILE)
    expect(src, '查看态的 <Markdown> 没有包 MarkdownBoundary —— 解析异常会让整篇笔记不可读').toContain('<MarkdownBoundary')
    const boundary = code('components/MarkdownBoundary.tsx')
    expect(boundary, '兜底必须真的渲染原文（而不是只报错）').toContain('whitespace-pre-wrap')
    expect(boundary, '兜底必须保留完整源码').toContain('this.props.source')
  })
})

describe('L · 离线读不到与正文格式无关（回答 markdown 猜想）', () => {
  it('L5 离线数据通路（缓存/队列/按 id 取密文）不碰 Markdown', () => {
    const offline = code('lib/client/offline.ts')
    expect(
      offline,
      'offline.ts 里出现了 markdown 相关引用 —— 离线取数据的通路本来就不该知道正文字体/格式，' +
      '一旦耦合，「某种格式的笔记离线打不开」才会真的成立',
    ).not.toMatch(/markdown|toPlainText/i)

    // 详情页取本地副本一律按 id（与内容无关）；解密在内存里做
    const entryView = code('components/EntryView.tsx')
    expect(entryView).toContain('getCachedEntryById(id)')
    expect(entryView).toContain('getQueuedEntryById(id)')
  })
})
