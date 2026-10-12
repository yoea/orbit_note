// 守卫：登录页与解锁页必须能一眼分清（2026-10-12 用户要求）。
//
// 背景：`app/login/page.tsx` 与 `components/UnlockPrompt.tsx` 是「同一界面元素的两份拷贝」——
// 除了一颗身份标识，**逐字相同**（连主按钮文案都曾是「使用通行密钥登录」）。用户分不清自己
// 在哪一页；而会话 cookie 30 天有效 ⇒ PWA 冷启动大多落在**解锁页**，不是 /login。
//
// 定稿（用户拍板「方案 A」）：
//   · 品牌下方各一枚胶囊：登录页 = 钥匙图标 + 「登录」；解锁页 = 锁图标 + 「解锁」
//   · 主按钮文案压成两个词：登录页「登录」、解锁页「解锁」（busy 态 正在登录… / 正在解锁…）
//   · 主按钮比全站主按钮（PRIMARY_BUTTON_CLASS 的 py-4/text-base）小一档：py-3 + text-sm + rounded-xl
//   · /login 整页只用一个身份词（登录）——恢复密钥那条路的按钮也从「解锁」改成「登录」
//
// 这条守卫的核心不是「有没有胶囊」，而是**两页必须不同**：
// 任何一天有人把解锁页抄回登录页的图标/文案，都必须立刻变红。
// 非空转验证：Temp/nonvacuous_login_identity.py（四个破坏用例）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classAttrsIn, classTokens, projectRoot, stripComments } from './class-attrs'

const LOGIN = 'app/login/page.tsx'
const UNLOCK = 'components/UnlockPrompt.tsx'

/** 身份胶囊的 class 前缀（两页共用的那串，唯一） */
const PILL = 'inline-flex items-center gap-1.5 rounded-full'
/** 钥匙图标（feather key）的路径特征 —— 只该出现在登录页 */
const KEY_PATH = 'M21 2l-2 2'
/** 锁图标（feather lock）的路径特征 —— 只该出现在解锁页 */
const LOCK_PATH = 'M7 11V7a5 5 0 0 1 10 0v4'

function code(rel: string): string {
  return stripComments(readFileSync(join(projectRoot, rel), 'utf8'))
}

/** 取身份胶囊那一段源码：从胶囊的 class 起到它自己的 `</span>` 止。
 *  用闭合标签当右界（而不是固定长度窗口）—— 窗口写大了会把下面的主按钮圈进来，
 *  于是「胶囊里的词」这条断言就被按钮文案喂成假通过。 */
function pillSlice(rel: string): string {
  const src = code(rel)
  const at = src.indexOf(PILL)
  expect(at, `${rel} 里找不到身份胶囊（${PILL}）—— 两页又要变成一模一样了`).toBeGreaterThanOrEqual(0)
  const end = src.indexOf('</span>', at)
  expect(end, `${rel} 的身份胶囊没有闭合的 </span>，切片会取到空串`).toBeGreaterThan(at)
  return src.slice(at, end)
}

/** 主操作按钮的 class 属性（两页都靠 `active:scale-[0.98]` 定位，各自唯一） */
function primaryButtonTokens(rel: string): string[] {
  const src = code(rel)
  const hits = classAttrsIn(rel, src).filter((a) => a.text.includes('active:scale-[0.98]'))
  expect(hits.length, `${rel} 里带 active:scale-[0.98] 的主按钮不是唯一一个`).toBe(1)
  return classTokens(hits[0].text)
}

describe('L · 登录页 / 解锁页的身份标识', () => {
  it('L0 解析自检：两个文件都读到了胶囊与主按钮（防断言空转）', () => {
    for (const rel of [LOGIN, UNLOCK]) {
      const src = code(rel)
      expect(src.length, `${rel} 读不到内容`).toBeGreaterThan(500)
      expect(src, `${rel} 里找不到身份胶囊`).toContain(PILL)
      expect(src, `${rel} 里找不到主按钮（active:scale-[0.98]）`).toContain('active:scale-[0.98]')
    }
  })

  it('L1 两页的身份胶囊视觉同档（同一份 class），不许各写一套', () => {
    const pillClass = (rel: string) => classAttrsIn(rel, code(rel)).filter((a) => a.text.includes(PILL))
    const a = pillClass(LOGIN)
    const b = pillClass(UNLOCK)
    expect(a.length, `${LOGIN} 的胶囊 class 不是唯一一个`).toBe(1)
    expect(b.length, `${UNLOCK} 的胶囊 class 不是唯一一个`).toBe(1)
    expect(
      a[0].text,
      '两页的胶囊 class 不一致 —— 字号/内距会各自漂移（两页是拷贝关系，视觉必须同档）',
    ).toBe(b[0].text)
  })

  it('L2 胶囊里的图标必须不同：登录页是钥匙、解锁页是锁', () => {
    const login = pillSlice(LOGIN)
    const unlock = pillSlice(UNLOCK)
    expect(login, `登录页胶囊里没有钥匙图标（${KEY_PATH}）`).toContain(KEY_PATH)
    expect(unlock, `解锁页胶囊里没有锁图标（${LOCK_PATH}）`).toContain(LOCK_PATH)
    // 反向：谁也別把对方的图标抄过来 —— 抄了这里就白改了
    expect(login, '登录页胶囊里出现了锁图标（两页又一样了）').not.toContain(LOCK_PATH)
    expect(unlock, '解锁页胶囊里出现了钥匙图标（两页又一样了）').not.toContain(KEY_PATH)
  })

  it('L3 胶囊里的词必须不同：登录页「登录」、解锁页「解锁」', () => {
    const login = pillSlice(LOGIN)
    const unlock = pillSlice(UNLOCK)
    expect(login, '登录页胶囊里没有「登录」两个字').toContain('登录')
    expect(unlock, '解锁页胶囊里没有「解锁」两个字').toContain('解锁')
    expect(login, '登录页胶囊里出现了「解锁」（两页又一样了）').not.toContain('解锁')
    expect(unlock, '解锁页胶囊里出现了「登录」（两页又一样了）').not.toContain('登录')
  })

  it('L4 主按钮文案压成两个词，且两页不同', () => {
    const login = code(LOGIN)
    const unlock = code(UNLOCK)
    // 旧文案绝不能再出现（它是「两页分不清」的直接原因）
    expect(login, '登录页主按钮又写回「使用通行密钥登录」了').not.toContain('使用通行密钥登录')
    expect(unlock, '解锁页主按钮又写回「使用通行密钥登录」了').not.toContain('使用通行密钥登录')
    expect(login, '登录页主按钮文案不是「登录」').toContain("{busy ? '正在登录…' : '登录'}")
    expect(unlock, '解锁页主按钮文案不是「解锁」').toContain("{busy ? '正在解锁…' : '解锁'}")
    // /login 整页只用一个身份词：恢复密钥那条路的按钮也是「登录」，不出现「解锁」
    const form = login.slice(login.indexOf('<form'), login.indexOf('</form>'))
    expect(form.length, '找不到恢复密钥表单，切片会空转').toBeGreaterThan(100)
    expect(form, '恢复密钥那条路的按钮又写回「解锁」—— 同一页会出现两个身份词').not.toContain('解锁')
  })

  it('L5 主按钮比全站主按钮小一档（py-3 / text-sm / rounded-xl）', () => {
    for (const rel of [LOGIN, UNLOCK]) {
      const tokens = primaryButtonTokens(rel)
      expect(tokens, `${rel} 的主按钮没有缩小（还是 py-4）`).not.toContain('py-4')
      expect(tokens, `${rel} 的主按钮没有缩小（还是 text-base）`).not.toContain('text-base')
      expect(tokens, `${rel} 的主按钮仍用大圆角 rounded-2xl`).not.toContain('rounded-2xl')
      expect(tokens, `${rel} 的主按钮不是 py-3`).toContain('py-3')
      expect(tokens, `${rel} 的主按钮不是 text-sm`).toContain('text-sm')
      expect(tokens, `${rel} 的主按钮不是 rounded-xl`).toContain('rounded-xl')
      // 仍是主按钮语义：全宽 + 品牌渐变 + 按下反馈 + 禁用态
      expect(tokens, `${rel} 的主按钮丢了 w-full`).toContain('w-full')
      expect(tokens, `${rel} 的主按钮丢了品牌渐变`).toContain('from-orange-500')
      expect(tokens, `${rel} 的主按钮丢了禁用态`).toContain('disabled:opacity-50')
    }
  })
})
