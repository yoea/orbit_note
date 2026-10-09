// 守卫：写页正文必须**跨 tab 切换保留**。
//
// 背景（2026-10-09 用户反馈）：
//   「在写页面输入文字后通过 tab 切换到列表页面，再切回写页面，输入框就会被清空，
//     然后顶部显示有草稿是否恢复。我的理解是切换 tab 应该不影响这三个页面状态才对。」
//
// 根因：底部三个 tab 页在 App Router 里是**互斥挂载**的 —— 切走即卸载组件，组件内的
// `text` state 随之丢失；回来重挂载时，挂载 effect 从 IndexedDB/服务器读到刚冲刷的草稿，
// 于是弹「有草稿是否恢复」横幅。用户看到的是「输入框被清空 + 还得手动点恢复」。
//
// ★ 草稿机制（IndexedDB + 服务器同步）的定位是**「关页面 / 崩溃 / 换设备」的兜底**，
//   不该拿来兜一次 tab 切换 —— 那是两件不同的事，两者都要成立。
//
// 做法：沿用列表页 `DiaryListView` 的模块级快照模式（`let snapshot` + `useState(() => …)`）。
//   模块级变量只活在**当前页面会话**里，刷新即失效 ⇒ 刷新后仍由草稿横幅兜底，那条路径不变。
//
// ★ 本文件全部断言基于 `stripComments` 后的源码：上面这些说明里就写着被断言的关键字。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot, stripComments } from './class-attrs'

const FILE = 'components/DiaryEditor.tsx'
const src = stripComments(readFileSync(join(projectRoot, FILE), 'utf8'))

describe('T · 写页正文跨 tab 切换保留', () => {
  it('T0 解析自检：源码读到了（防断言空转）', () => {
    expect(src.length, '源码没读到，后面的断言会全部空转').toBeGreaterThan(3000)
    expect(src, '锚点缺失').toContain('DiaryEditor')
  })

  it('T1 存在模块级正文快照（组件卸载后仍活着）', () => {
    expect(
      src,
      '缺少模块级 `let editorSnapshot` —— 切走 tab 后组件卸载，正文就没了',
    ).toMatch(/^let editorSnapshot = ''/m)
  })

  it('T2 text / textRef 都从快照初始化（否则切回来是空的、且会误弹草稿横幅）', () => {
    expect(src, 'text state 没有从快照初始化 ⇒ 切回来输入框被清空').toMatch(
      /useState\(\(\) => editorSnapshot\)/,
    )
    // textRef 也必须同步：挂载 effect 用 `textRef.current === ''` 判断要不要弹草稿横幅，
    // 少了这一条，正文虽然恢复了，顶上还是会弹一个多余的「恢复草稿」。
    expect(src, 'textRef 没有从快照初始化 ⇒ 会误弹「有草稿是否恢复」').toMatch(
      /useRef\(editorSnapshot\)/,
    )
  })

  it('T3 正文变化时同步回快照（保存/恢复草稿等路径都要跟上）', () => {
    expect(
      src,
      '缺少「正文变化 → 同步快照」的 effect —— 快照会停在初始值，等于没保留',
    ).toMatch(/useEffect\(\(\) => \{ editorSnapshot = text \}, \[text\]\)/)
  })

  it('T4 快照非空时不得弹「恢复草稿」横幅（切 tab 触发的那次是误报）', () => {
    // 挂载 effect 里的这个前置条件就是抑制开关：正文已从快照恢复 ⇒ textRef 非空 ⇒ 不弹。
    expect(
      src,
      '横幅的抑制条件不见了 ⇒ 切回写页会弹「有草稿是否恢复」，用户以为输入被清空了',
    ).toMatch(/if \(textRef\.current === ''\) \{/)
  })
})
