// 守卫：草稿的「保存」与「清理」必须对称。
//
// 背景（2026-10-09 用户复现）：
//   1) 输入「你好啊」，收起键盘 → 存成草稿；
//   2) 重新打开键盘，**全部删掉**；
//   3) 收起键盘 → 预期草稿被清空；
//   4) 切到别的 tab 再切回来 → 仍提示「有草稿是否恢复」，恢复出来还是「你好啊」。
//
// 根因：**没有任何一条路径会在正文变空时清掉已存的草稿。**
//   · `flushDraft` 内部 `if (!dek || !text.trim()) return` —— 不写空草稿（这条本身是对的）；
//   · 卸载/pagehide：`if (current.trim()) void flushDraft(current)` —— 空正文直接跳过；
//   · 防抖入口同样只调 flushDraft。
//   三者叠加 ⇒ 「不写空的」被当成了「不用管」，库里那条旧草稿永远活着。
//   ★ 而且只清本地不够：下次挂载时服务器草稿是**独立的一条来源**（`if (server && !best)`），
//     会把它当成更新的草稿重新弹出来。
//
// 定稿：把「当前正文 → 草稿」收敛成一个入口 `syncDraft(text)`：
//   有内容 → flushDraft（存/推）；空 → clearStoredDraft（本地 + 服务器一起清）。
//
// ★ 全部断言基于 `stripComments` 后的源码 —— 上面的说明里就写着被断言的关键字。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot, stripComments } from './class-attrs'

const FILE = 'components/DiaryEditor.tsx'
const src = stripComments(readFileSync(join(projectRoot, FILE), 'utf8'))

/** 从 needle 起取一段窗口。⚠️ 传的是**长度**不是绝对下标。 */
function windowFrom(needle: string, len: number): string {
  const i = src.indexOf(needle)
  expect(i, `锚点「${needle}」找不到，后面的断言会空转`).toBeGreaterThanOrEqual(0)
  return src.slice(i, i + len)
}

/** 取 [open, close) 之间的源码切片 —— 锚点必须唯一。
 *  为什么不用固定长度窗口：`void syncDraft(textRef.current)` 在 flushNow 与 onOnline 里
 *  各出现一次，600 字窗口会把两者一起圈进来 ⇒ 破坏了 flushNow 里的那次，断言照样通过
 *  （**非空转验证当场抓到的空转**）。 */
function sliceBetween(open: string, close: string): string {
  const a = src.indexOf(open)
  const b = src.indexOf(close)
  expect(a, `起始锚点「${open}」找不到`).toBeGreaterThanOrEqual(0)
  expect(b, `结束锚点「${close}」没找到或晚于起始锚点`).toBeGreaterThan(a)
  return src.slice(a, b)
}

describe('D · 草稿的保存与清理必须对称', () => {
  it('D0 解析自检：锚点齐全（防断言空转）', () => {
    expect(src.length).toBeGreaterThan(3000)
    for (const n of ['syncDraft', 'clearStoredDraft', 'onDraftChange', 'flushNow', 'userEditedRef']) {
      expect(src, `找不到锚点「${n}」`).toContain(n)
    }
  })

  it('D1 存在统一入口 syncDraft：有内容存草稿、空内容清草稿', () => {
    const fn = windowFrom('const syncDraft = useCallback', 400)
    expect(
      fn,
      '正文为空时没有走清理分支 ⇒ 旧草稿会留在库里（这正是本次 bug 的直接成因）',
    ).toMatch(/if \(!text\.trim\(\)\) await clearStoredDraft\(\)/)
    expect(fn, '有内容时没有走保存分支').toMatch(/else await flushDraft\(text\)/)
  })

  it('D2 防抖入口走 syncDraft（用户在输入框里全删后 1s 就要清掉草稿）', () => {
    const fn = windowFrom('function onDraftChange', 400)
    expect(
      fn,
      '防抖回调还在直接调 flushDraft ⇒ 空文本会被 flushDraft 内部的 guard 静默吞掉',
    ).toContain('void syncDraft(text)')
    expect(fn, '用户编辑入口没有置 userEditedRef ⇒ 卸载时无法区分「改过」与「没动过」').toContain(
      'userEditedRef.current = true',
    )
  })

  it('D3 卸载/pagehide 也走 syncDraft，且带「用户没改过就不碰草稿」的保护', () => {
    // 只取 flushNow 自己的函数体（到 onPageHide 为止）—— onOnline 里也有一次
    // `void syncDraft(textRef.current)`，用长窗口会把那次一起圈进来造成空转。
    const fn = sliceBetween('const flushNow = () =>', 'const onPageHide')
    expect(fn, '卸载冲刷没有走 syncDraft（空正文清不掉、非空正文也会漏存）').toContain(
      'void syncDraft(textRef.current)',
    )
    // 反向保护：打开写页、顶上还弹着「有草稿是否恢复」没决策就直接切走，
    // 那次卸载绝不能把草稿删掉。
    expect(
      fn,
      '卸载冲刷缺少 userEditedRef 保护 ⇒ 「看到恢复横幅后直接切走」会把还没被决策的草稿删掉',
    ).toContain('if (!userEditedRef.current) return')
  })

  it('D4 clearStoredDraft 必须**同时**清本地与服务器，并作废进行中的冲刷', () => {
    const fn = windowFrom('const clearStoredDraft = useCallback', 700)
    expect(fn, '没有清本地草稿').toContain('await clearLocalDraft()')
    expect(
      fn,
      "没有清服务器草稿 ⇒ 下次挂载会被当成更新的草稿重新弹出来（服务器是独立的一条来源）",
    ).toContain("fetch('/api/draft', { method: 'DELETE' })")
    expect(fn, '没有作废进行中的冲刷 ⇒ 刚清掉的草稿可能被写回来').toContain(
      'draftEpochRef.current++',
    )
  })

  it('D5 反向：不得再出现「正文为空就跳过、什么都不做」的老写法', () => {
    // `if (current.trim()) void flushDraft(current)` 就是本次 bug 的原形。
    expect(
      src,
      '又出现「空正文直接跳过」的写法 ⇒ 用户删光文字后旧草稿会永远留在库里',
    ).not.toMatch(/if \(current\.trim\(\)\)/)
  })
})
