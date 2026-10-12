// 守卫：登录页与解锁页必须能一眼分清（2026-10-12 用户要求 · 定稿版）。
//
// 背景：`app/login/page.tsx` 与 `components/UnlockPrompt.tsx` 是「同一界面元素的两份拷贝」——
// 除了一处身份标识，**逐字相同**（连主按钮文案都曾是「使用通行密钥登录」）。用户分不清自己
// 在哪一页；而会话 cookie 30 天有效 ⇒ PWA 冷启动大多落在**解锁页**，不是 /login。
//
// 定稿（用户三轮拍板）：身份标识**融进主按钮**，不另占一行 ——
//   · 登录页：[钥匙图标] + 「使用通行密钥登录」
//   · 解锁页：[锁图标]   + 「解锁」
//   · 按钮样式**与写页「保存」同源**：PRIMARY_BUTTON_CLASS + BRAND_GRADIENT_CLASS
//     （py-4 / rounded-2xl / 16px 字）—— 这里先在登录页手写过「小一档」的串，用户要求统一，
//     那正是 primary-button.test.ts 存在的理由，故该文件也把这两页纳进了 CONSUMERS
//   · 额外加 flex + items-center + justify-center + gap-2：按钮默认的 text-align:center
//     只对纯文本有效，加了图标就必须自己排
//   · /login 整页只用一个身份词（登录）：恢复密钥那条路的按钮也走同一个常量、也是「登录」
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
/** 主按钮常量的标识符 —— 「单一样式源」的证据。
 *  ⚠️ classAttrsIn 会把常量**展开成值**，所以查它必须看源码原文，不能看解析出来的 class。 */
const PRIMARY_SRC = 'PRIMARY_BUTTON_CLASS'
/** 身份按钮特有的图标排版类（在按钮常量之外额外加的）。
 *  两页各只有一处；恢复密钥那条路的按钮也走常量但**没有它**，所以用它定位身份按钮。 */
const IDENT_ANCHOR = 'justify-center gap-2'

function code(rel: string): string {
  return stripComments(readFileSync(join(projectRoot, rel), 'utf8'))
}

/** 身份按钮那一段源码：从它的 `className` 起到自己的 `</button>` 止（图标与文案都在里面）。
 *  ★ 起点不能用 `PRIMARY_BUTTON_CLASS` —— 它**在 import 行里先出现一次**，那样会从 import
 *    切到下一个 `</button>`（页面上的别的按钮），断言全是假的。用图标排版锚反查 className。
 *  ★ 右界必须是它自己的闭合标签，不能写固定长度窗口 —— 窗口写大了会把页面上别处的
 *    文案圈进来，于是「按钮里的词」这条断言被外人喂成假通过。 */
function buttonSlice(rel: string): string {
  const src = code(rel)
  const anchor = src.indexOf(IDENT_ANCHOR)
  expect(anchor, `${rel} 里找不到身份按钮的图标排版锚（${IDENT_ANCHOR}）`).toBeGreaterThanOrEqual(0)
  const start = src.lastIndexOf('className', anchor)
  expect(start, `${rel} 的锚之前找不到 className（切片起点会错）`).toBeGreaterThanOrEqual(0)
  const end = src.indexOf('</button>', anchor)
  expect(end, `${rel} 的身份按钮没有闭合的 </button>，切片会取到空串`).toBeGreaterThan(anchor)
  return src.slice(start, end)
}

/** 身份按钮的 class 属性（靠 IDENT_ANCHOR 定位，两页各唯一） */
function buttonClass(rel: string) {
  const hits = classAttrsIn(rel, code(rel)).filter((a) => a.text.includes(IDENT_ANCHOR))
  expect(hits.length, `${rel} 里带「${IDENT_ANCHOR}」的身份按钮不是唯一一个`).toBe(1)
  return hits[0]
}

describe('L · 登录页 / 解锁页的身份标识（在主按钮里）', () => {
  it('L0 解析自检：两个文件都读到了身份按钮（防断言空转）', () => {
    for (const rel of [LOGIN, UNLOCK]) {
      const src = code(rel)
      expect(src.length, `${rel} 读不到内容`).toBeGreaterThan(500)
      expect(src, `${rel} 里找不到身份按钮的图标排版锚`).toContain(IDENT_ANCHOR)
      expect(src, `${rel} 没用主按钮常量（单一样式源）`).toContain(PRIMARY_SRC)
      expect(buttonSlice(rel).length, `${rel} 的身份按钮切片过短，后面的断言会空转`).toBeGreaterThan(200)
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
    // /login 整页只用一个身份词、也只用一个按钮样式源：恢复密钥那条路同样是「登录」+ 同一个常量
    const login = code(LOGIN)
    const form = login.slice(login.indexOf('<form'), login.indexOf('</form>'))
    expect(form.length, '找不到恢复密钥表单，切片会空转').toBeGreaterThan(100)
    expect(form, '恢复密钥那条路的按钮又写回「解锁」—— 同一页会出现两个身份词').not.toContain('解锁')
    expect(form, '恢复密钥那条路的按钮没走 PRIMARY_BUTTON_CLASS —— 同一页两个按钮会一个高一个矮').toContain(PRIMARY_SRC)
  })

  it('L5 身份按钮与写页「保存」同源（同一个常量），且图标与文字一行居中', () => {
    for (const rel of [LOGIN, UNLOCK]) {
      const raw = buttonSlice(rel)
      expect(raw, `${rel} 的身份按钮没走 PRIMARY_BUTTON_CLASS（又手写了一份尺寸）`).toContain(PRIMARY_SRC)
      expect(raw, `${rel} 的身份按钮没走 BRAND_GRADIENT_CLASS`).toContain('BRAND_GRADIENT_CLASS')

      const tokens = classTokens(buttonClass(rel).text)
      // 与写页「保存」逐项同值（常量展开后的真实 token）
      expect(tokens, `${rel} 的身份按钮高度不是 py-4（与保存按钮不一致）`).toContain('py-4')
      expect(tokens, `${rel} 的身份按钮圆角不是 rounded-2xl`).toContain('rounded-2xl')
      expect(tokens, `${rel} 的身份按钮丢了过渡属性`).toContain('transition-colors')
      expect(tokens, `${rel} 的身份按钮按下降幅不是 0.99`).toContain('active:scale-[0.99]')
      expect(tokens, `${rel} 的身份按钮丢了 w-full`).toContain('w-full')
      expect(tokens, `${rel} 的身份按钮丢了品牌渐变`).toContain('from-orange-500')
      expect(tokens, `${rel} 的身份按钮丢了禁用态`).toContain('disabled:opacity-50')
      // 图标 + 文字必须自己排版：按钮默认的 text-align:center 管不了图标
      expect(tokens, `${rel} 的身份按钮没有 flex（图标与文字排不到一行居中）`).toContain('flex')
      expect(tokens, `${rel} 的身份按钮没有 justify-center`).toContain('justify-center')
      expect(tokens, `${rel} 的身份按钮图标与文字之间没有间距`).toContain('gap-2')
      // 反向：不许再退回「某一页偷偷小一档」的那套值
      expect(tokens, `${rel} 的身份按钮又变小了（py-3）`).not.toContain('py-3')
      expect(tokens, `${rel} 的身份按钮字号又变小了（text-sm）`).not.toContain('text-sm')
      expect(tokens, `${rel} 的身份按钮圆角又变小了（rounded-xl）`).not.toContain('rounded-xl')
      expect(tokens, `${rel} 的身份按钮按下降幅又写成 0.98 了`).not.toContain('active:scale-[0.98]')
    }
  })
})
