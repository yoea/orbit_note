import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot, stripComments } from './class-attrs'

// ============================================================================
// 关于弹窗：紧凑化 + 版本行合并（2026-10-02 用户要求）
//
//   ① 「将版本号移到底部与版权、开源说明同一行」
//   ② 「精简『地名和天气说明』那句话」
//   ③ 「整体缩小各元素之间的垂直间距」
//
// 前两条是结构性的、可断言的；第三条（间距数值）属于观感，不设断言——把它锁死只会
// 让以后微调间距时被迫改测试，属于「假守卫」。
// ============================================================================

const REL = 'components/AboutDialog.tsx'
const SRC = stripComments(readFileSync(join(projectRoot, REL), 'utf8'))

describe('关于弹窗（紧凑化）', () => {
  it('A0 解析自检：拿到的是 AboutDialog 源码（防空转）', () => {
    expect(SRC.length).toBeGreaterThan(1000)
    expect(SRC).toContain('export default function AboutDialog')
    // 注释必须已被剥离，否则下面「不得出现 BigDataCloud」会因为注释里的说明而误判
    expect(SRC).not.toContain('原文点名了')
  })

  it('A1 版本号只在页脚出现一次，且与版权 / 开源说明**同一个 <p>**', () => {
    const count = SRC.split('NEXT_PUBLIC_VERSION').length - 1
    expect(count, '版本号应只出现一次（Hero 的版本胶囊已取消，别再加回来）').toBe(1)

    const i = SRC.indexOf('MIT 开源')
    expect(i, '页脚缺少「MIT 开源」').toBeGreaterThan(-1)
    const open = SRC.lastIndexOf('<p', i)
    const close = SRC.indexOf('</p>', i)
    expect(close).toBeGreaterThan(open)
    const line = SRC.slice(open, close)
    expect(line, '版本号必须与开源说明同一个 <p>（否则不叫「同一行」）').toContain('NEXT_PUBLIC_VERSION')
    expect(line, '版权声明必须在同一行').toContain('© 2026')
  })

  it('A2 第三方说明已精简（不再点名具体服务商）', () => {
    expect(SRC, '精简后的说明缺失').toContain('地名与天气来自第三方服务')
    expect(SRC, '不该再点名 BigDataCloud').not.toContain('BigDataCloud')
    expect(SRC, '不该再点名和风天气').not.toContain('和风天气')
  })

  it('A3 GitHub 入口仍在（从 Hero 胶囊搬到页脚行首，别顺手删掉）', () => {
    expect(SRC).toContain('github.com/yoea/orbit_note')
  })
})
