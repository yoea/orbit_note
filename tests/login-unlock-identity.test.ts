// 守卫：登录页与解锁页必须能一眼分清（2026-10-12 用户要求 · 定稿版）。
//
// 背景：`app/login/page.tsx` 与 `components/UnlockPrompt.tsx` 是「同一界面元素的两份拷贝」——
// 除了一处身份标识，**逐字相同**（连主按钮文案都曾是「使用通行密钥登录」）。用户分不清自己
// 在哪一页；而会话 cookie 30 天有效 ⇒ PWA 冷启动大多落在**解锁页**，不是 /login。
//
// 定稿（用户两轮拍板）：身份标识**融进主按钮**，不另占一行 ——
//   · 登录页：[钥匙图标] + 「使用通行密钥登录」
//   · 解锁页：[锁图标]   + 「解锁」
//   · 按钮比全站主按钮（PRIMARY_BUTTON_CLASS 的 py-4/text-base）小一档：py-3 + text-sm + rounded-xl
//   · 图标与文字一行居中（flex + justify-center + gap-2）——按钮默认的 text-align:center
//     只对纯文本有效，加了图标就必须自己排
//   · /login 整页只用一个身份词（登录）：恢复密钥那条路的按钮也是「登录」，不出现「解锁」
//
// ★ 这条守卫的核心不是「有没有图标/文案」，而是**两页必须不同**：
// 任何一天有人把解锁页抄回登录页的图标或文案，都必须立刻变红。
// 非空转验证：Temp/nonvacuous_login_identity.py（五个破坏用例）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classAttrsIn, classTokens, projectRoot, stripComments } from './class-attrs'

const LOGIN = 'app/login/page.tsx'
const UNLOCK = 'components/UnlockPrompt.tsx'

/** 钥匙图标（feather key）的路径特征 —— 只该出现在登录页的按钮里 */
const KEY_PATH = 'M21 2l-2 2'
/** 锁图标（feather lock）的路径特征 —— 只该出现在解锁页的按钮里 */
const LOCK_PATH = 'M7 11V7a5 5 0 0 1 10 0v4'
/** 定位主按钮用的锚（两页各自唯一；恢复密钥那条路的按钮没有它） */
const BTN_ANCHOR = 'active:scale-[0.98]'

function code(rel: string): string {
  return stripComments(readFileSync(join(projectRoot, rel), 'utf8'))
}

/** 主按钮那一段源码：从它的 class 起到自己的 `</button>` 止（图标与文案都在里面）。
 *  ★ 右界必须是它自己的闭合标签，不能写固定长度窗口 —— 窗口写大了会把页面上别处的
 *    文案圈进来，于是「按钮里的词」这条断言被外人喂成假通过。 */
function buttonSlice(rel: string): string {
  const src = code(rel)
  const at = src.indexOf(BTN_ANCHOR)
  expect(at, `${rel} 里找不到主按钮（${BTN_ANCHOR}）`).toBeGreaterThanOrEqual(0)
  const end = src.indexOf('</button>', at)
  expect(end, `${rel} 的主按钮没有闭合的 </button>，切片会取到空串`).toBeGreaterThan(at)
  return src.slice(at, end)
}

/** 主按钮的 class 属性（两页都靠 BTN_ANCHOR 定位，各自唯一） */
function buttonClass(rel: string) {
  const hits = classAttrsIn(rel, code(rel)).filter((a) => a.text.includes(BTN_ANCHOR))
  expect(hits.length, `${rel} 里带 ${BTN_ANCHOR} 的主按钮不是唯一一个`).toBe(1)
  return hits[0]
}

describe('L · 登录页 / 解锁页的身份标识（在主按钮里）', () => {
  it('L0 解析自检：两个文件都读到了主按钮（防断言空转）', () => {
    for (const rel of [LOGIN, UNLOCK]) {
      const src = code(rel)
      expect(src.length, `${rel} 读不到内容`).toBeGreaterThan(500)
      expect(src, `${rel} 里找不到主按钮`).toContain(BTN_ANCHOR)
      expect(buttonSlice(rel).length, `${rel} 的主按钮切片过短，后面的断言会空转`).toBeGreaterThan(200)
    }
  })

  it('L1 两页主按钮的 class 逐字相同（视觉同档，不许各写一套）', () => {
    expect(
      buttonClass(LOGIN).text,
      '两页的主按钮 class 不一致 —— 尺寸/圆角会各自漂移（两页是拷贝关系，只有图标与文案该不同）',
    ).toBe(buttonClass(UNLOCK).text)
  })

  it('L2 按钮里的图标必须不同：登录页是钥匙、解锁页是锁', () => {
    const login = buttonSlice(LOGIN)
    const unlock = buttonSlice(UNLOCK)
    expect(login, `登录页按钮里没有钥匙图标（${KEY_PATH}）`).toContain(KEY_PATH)
    expect(unlock, `解锁页按钮里没有锁图标（${LOCK_PATH}）`).toContain(LOCK_PATH)
    // 反向：谁也別把对方的图标抄过来 —— 抄了这次改动就白做了
    expect(login, '登录页按钮里出现了锁图标（两页又一样了）').not.toContain(LOCK_PATH)
    expect(unlock, '解锁页按钮里出现了钥匙图标（两页又一样了）').not.toContain(KEY_PATH)
  })

  it('L3 按钮里的文案必须不同：登录页「使用通行密钥登录」、解锁页「解锁」', () => {
    const login = buttonSlice(LOGIN)
    const unlock = buttonSlice(UNLOCK)
    expect(login, '登录页按钮文案不是「使用通行密钥登录」').toContain('使用通行密钥登录')
    expect(unlock, '解锁页按钮文案不是「解锁」').toContain('解锁')
    expect(login, '登录页按钮里出现了「解锁」（两页又一样了）').not.toContain('解锁')
    expect(unlock, '解锁页按钮里出现了「登录」（两页又一样了）').not.toContain('登录')
  })

  it('L4 忙碌态文案跟着各自的身份词（别又退回同一句）', () => {
    expect(code(LOGIN), '登录页忙碌态文案不对').toContain("{busy ? '正在验证…' : '使用通行密钥登录'}")
    expect(code(UNLOCK), '解锁页忙碌态文案不对').toContain("{busy ? '正在解锁…' : '解锁'}")
    // /login 整页只用一个身份词：恢复密钥那条路的按钮也是「登录」，不出现「解锁」
    const login = code(LOGIN)
    const form = login.slice(login.indexOf('<form'), login.indexOf('</form>'))
    expect(form.length, '找不到恢复密钥表单，切片会空转').toBeGreaterThan(100)
    expect(form, '恢复密钥那条路的按钮又写回「解锁」—— 同一页会出现两个身份词').not.toContain('解锁')
  })

  it('L5 按钮比全站主按钮小一档，且图标与文字一行居中', () => {
    for (const rel of [LOGIN, UNLOCK]) {
      const tokens = classTokens(buttonClass(rel).text)
      expect(tokens, `${rel} 的主按钮没有缩小（还是 py-4）`).not.toContain('py-4')
      expect(tokens, `${rel} 的主按钮没有缩小（还是 text-base）`).not.toContain('text-base')
      expect(tokens, `${rel} 的主按钮仍用大圆角 rounded-2xl`).not.toContain('rounded-2xl')
      expect(tokens, `${rel} 的主按钮不是 py-3`).toContain('py-3')
      expect(tokens, `${rel} 的主按钮不是 text-sm`).toContain('text-sm')
      expect(tokens, `${rel} 的主按钮不是 rounded-xl`).toContain('rounded-xl')
      // 图标 + 文字必须自己排版：按钮默认的 text-align:center 管不了图标
      expect(tokens, `${rel} 的主按钮没有 flex（图标与文字排不到一行居中）`).toContain('flex')
      expect(tokens, `${rel} 的主按钮没有 justify-center`).toContain('justify-center')
      expect(tokens, `${rel} 的主按钮图标与文字之间没有间距`).toContain('gap-2')
      // 仍是主按钮语义：全宽 + 品牌渐变 + 按下反馈 + 禁用态
      expect(tokens, `${rel} 的主按钮丢了 w-full`).toContain('w-full')
      expect(tokens, `${rel} 的主按钮丢了品牌渐变`).toContain('from-orange-500')
      expect(tokens, `${rel} 的主按钮丢了禁用态`).toContain('disabled:opacity-50')
    }
  })
})
