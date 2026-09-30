// 守卫：「无改动不保存」。
//
// 详情页编辑态点「保存修改」时，若正文与「进入编辑态时的快照」逐字符相同，
// 必须**在发任何写请求之前**直接退出编辑态。
//
// 为什么值得钉住：
//   1. 这条分支只在「用户什么都没改」时生效，人工回归最容易漏；
//   2. 一旦退回「无条件 PATCH」，服务端会把 updatedAt 顶掉（只有带 ciphertext 的
//      PATCH 才更新它，见 app/api/diary/[id]/route.ts）⇒ 详情页凭空多出「编辑于」，
//      而正文毫无变化：属于**看不出来、却会持续污染数据**的那类 bug；
//   3. 保存与取消两条路径必须共用同一个快照 editSnapshotRef，否则两边判定不一致
//      （取消按钮早就比对快照并静默退出，保存按钮漏了——这就是当初的 bug）。
//
// 这里只做「顺序 + 表达式」级别的源码断言，不做 React 交互测试：
// 项目没装 jsdom / testing-library，为这一条不变量引入它们不划算。
// 因此断言写成「先比对 → 再 return → 最后才写」，而不是"文件里出现过某个字符串"。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot, stripComments } from './class-attrs'

const FILE = 'components/EntryView.tsx'
const GUARD = 'plain === editSnapshotRef.current'

/** 取出 saveEdit 回调体（截到下一个顶层 useCallback 为止），调用方负责先剥注释 */
function saveEditBody(src: string): string {
  const start = src.indexOf('const saveEdit = useCallback(')
  const end = src.indexOf('const remove = useCallback(', start)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`无法定位 saveEdit 回调体（${FILE} 结构变了？start=${start} end=${end}）`)
  }
  return src.slice(start, end)
}

describe('详情页「保存修改」的无改动拦截', () => {
  const src = stripComments(readFileSync(join(projectRoot, FILE), 'utf8'))

  it('S0 解析自检：确实取到了 saveEdit 回调体（否则后面全是空转）', () => {
    const body = saveEditBody(src)
    expect(body.length).toBeGreaterThan(200)
    // 正常保存路径的发请求代码必须在体内，否则说明切片切错了位置
    expect(body).toContain("method: 'PATCH'")
  })

  it('S1 保存前必须与 editSnapshotRef 快照比对', () => {
    expect(saveEditBody(src)).toContain(GUARD)
  })

  it('S2 比对必须早于任何写操作，且以 return 提前退出', () => {
    const body = saveEditBody(src)
    const guard = body.indexOf(GUARD)
    const writes = ['fetch(', 'updateQueuedEntry(']
      .map((k) => body.indexOf(k))
      .filter((i) => i >= 0)
    expect(writes.length).toBeGreaterThan(0)
    const firstWrite = Math.min(...writes)
    expect(guard).toBeLessThan(firstWrite)
    // 只"比对了一下、然后照旧发请求"同样是 bug
    expect(body.slice(guard, firstWrite)).toContain('return')
  })

  it('S3 拦截必须早于 setBusy(true)（否则先闪一下「保存中…」再退出）', () => {
    const body = saveEditBody(src)
    // 先各自确认「存在」：indexOf 返回 -1 时「-1 < 正数」恒真，
    // 只写一句 toBeLessThan 会在此处假通过（破坏 A 实测踩到过）。
    const guard = body.indexOf(GUARD)
    const busy = body.indexOf('setBusy(true)')
    expect(guard, '未找到无改动拦截').toBeGreaterThanOrEqual(0)
    expect(busy, '未找到 setBusy(true)').toBeGreaterThanOrEqual(0)
    expect(guard).toBeLessThan(busy)
  })

  it('S4 保存与取消共用同一个快照，两处判定一致', () => {
    // 至少两处：saveEdit 的拦截 + 右上角「取消」按钮的静默退出
    expect(src.split(GUARD).length - 1).toBeGreaterThanOrEqual(2)
  })
})
