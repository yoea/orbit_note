// 守卫：「随机生成昵称」只属于懒创建，改名弹窗不得再长出随机按钮。
//
// 背景（用户明确要求）：改名弹窗里输入框下方曾有一个「随机生成一个」按钮，一键把名字
// 换成新的 Orbit_xxx —— 与「改名」这个主动表达偏好的动作语义相反，还会静默覆盖用户
// 刚起的名字。已移除。
//
// 同时钉住一个容易被误解的事实：**首次注册流程（app/setup）根本不参与昵称生成**。
// 「Orbit_xxx」是 lib/client/profile.ts 的 loadUserName 懒创建出来的——发生在「用户第一次
// 进入需要显示名字的页面」那一刻（设置页/首页），库里没有名字才生成并落库。也就是说
// 随机生成能力只有这**唯一**一个入口，任何 UI（含 setup）都不该再出现第二个。
//
// 断言前一律剥离注释：否则「不再提供『随机生成一个』」这类说明文字本身就会把断言打红，
// 逼着后来人去删警告（footnote-contrast.test.ts 同款做法）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectSourceFiles, projectRoot, stripComments } from './class-attrs'

const DIALOG = 'components/NameEditDialog.tsx'
const PROFILE = 'lib/client/profile.ts'
const SETUP = 'app/setup/page.tsx'

function code(rel: string): string {
  return stripComments(readFileSync(join(projectRoot, rel), 'utf8'))
}

/** app/ components/ lib/ 下全部源码（已剥注释），路径归一化成 POSIX 相对路径。
 *  Windows 上 path.join 产出的反斜杠会让「按文件名比较」永远不相等（断言静默空转），故必须归一化。 */
function allSources(): { file: string; src: string }[] {
  return ['app', 'components', 'lib']
    .flatMap((dir) => collectSourceFiles(join(projectRoot, dir)))
    .map((f) => ({
      file: f.slice(projectRoot.length).replace(/\\/g, '/'),
      src: stripComments(readFileSync(f, 'utf8')),
    }))
}

describe('改名弹窗：不再提供「随机生成一个」', () => {
  it('N0 解析自检：能读到弹窗源码（防空转）', () => {
    const src = code(DIALOG)
    expect(src.length).toBeGreaterThan(500)
    expect(src).toContain('修改名字')
    expect(src).toContain('USER_NAME_MAX')
  })

  it('N1 弹窗内没有随机生成按钮，也不引用 generateDefaultName', () => {
    const src = code(DIALOG)
    expect(src, '「随机生成一个」按钮不得回到改名弹窗').not.toContain('随机生成')
    expect(src, '改名弹窗不该能直接生成默认名（那是懒创建的职责）').not.toContain('generateDefaultName')
  })

  it('N2 移除按钮不等于砍掉字数计数', () => {
    // 用户只要求移除按钮；「n/20」的字数统计必须保留（改名时判断长度上限要靠它）
    expect(code(DIALOG)).toMatch(/\{trimmed\.length\}\/\{USER_NAME_MAX\}/)
  })
})

describe('默认名（Orbit_xxx）只有懒创建这一个入口', () => {
  it('N3 generateDefaultName 只出现在 lib/client/profile.ts', () => {
    const offenders = allSources()
      .filter((s) => s.file !== PROFILE && s.src.includes('generateDefaultName'))
      .map((s) => s.file)
    expect(offenders, `除 ${PROFILE} 外不应有任何文件引用 generateDefaultName`).toEqual([])
  })

  it('N4 调用点在 loadUserName 内部（「库里还没有名字」才生成）', () => {
    const src = code(PROFILE)
    const start = src.indexOf('export async function loadUserName')
    expect(start, '找不到 loadUserName').toBeGreaterThanOrEqual(0)
    expect(src.slice(start), 'loadUserName 里必须调用 generateDefaultName').toContain('generateDefaultName()')
  })

  it('N5 首次注册流程（app/setup）不参与昵称生成', () => {
    const src = code(SETUP)
    expect(src.length, 'setup 页读不到内容，断言会空转').toBeGreaterThan(500)
    for (const banned of ['generateDefaultName', '随机生成', '昵称', 'Orbit_']) {
      expect(src, `setup 流程不该出现「${banned}」`).not.toContain(banned)
    }
  })
})
