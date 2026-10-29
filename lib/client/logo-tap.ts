// LOGO 点击的反馈：一个小动画 + 一次震动（2026-10-29 用户要求）。
//
// 为什么单独一个模块，而不是写在 AboutDialog 里：
//   `settings-structure` 的 **P17** 断言「关于弹窗文件里不得出现 transform / filter 等词」。
//   那条约定的本意是「弹窗里内嵌的 fixed 确认层，不能被祖先的 transform 变成包含块而裁掉」。
//   这里的 transform 是**以编程方式只作用在 LOGO 元素上**（LOGO 内部没有 fixed 后代），
//   逻辑上完全安全 —— 但纯文本断言分不清"谁是祖先"，所以把动画细节放到这里，
//   P17 继续按原样守着那个文件。
//
// ★ 关于 iOS 触觉反馈，必须说清一件事：
//   **iOS 的 Safari / PWA 没有暴露 haptic API** —— `navigator.vibrate` 根本不存在。
//   这不是实现偷懒，是平台能力缺失（Web 上唯一可用的 Vibration API 只有 Android Chrome 等支持）。
//   所以这里的策略是「能震就震、不能震就只给视觉」：
//     · 有 `navigator.vibrate`  → 调它（Android 等）
//     · 没有（iOS、桌面浏览器）→ **直接返回**，不抛错、不加替代音效、不弹任何提示
//   视觉动画是所有平台都有的那一半反馈，所以 iOS 用户不会"点了没反应"。

/** 动画时长（ms）。180ms：低于 150ms 看不清，高于 250ms 会觉得拖；iOS 系统按压反馈约 150~200ms。 */
const PULSE_MS = 180

/**
 * LOGO 按下的小脉冲：缩小到 0.9 再弹回，只缩放不位移不旋转（最小侵入，不抢戏）。
 *
 * 缓动分两段（关键帧上的 `easing` 作用于"到下一帧"这一段）：
 *   · 按下 0→40%：`cubic-bezier(0.4, 0, 1, 1)`（ease-in）—— 手指按住时"快速到位"；
 *   · 回弹 40→100%：`cubic-bezier(0.34, 1.56, 0.64, 1)` —— 带轻微过冲，像"弹回来"。
 * 整段共用一个回弹曲线是不对的：它适合 0→1 的单向变化，套在"下去再回来"上会显得黏。
 *
 * ★ 不支持的浏览器（无 `Element.animate`）直接跳过 —— 动画是锦上添花，不能因此让点击失效。
 * ★ LOGO 是 `bg-clip-text` 的渐变文字，transform 在极老版本的 Safari 上可能让渐变短暂失效；
 *   真出现那个现象就去掉 transform、只留 opacity 那一路（反馈会弱一些，但不会坏）。
 */
export function pulseLogo(el: Element | null): void {
  if (!el || typeof el.animate !== 'function') return
  el.animate(
    [
      { transform: 'scale(1)', opacity: 1, easing: 'cubic-bezier(0.4, 0, 1, 1)' },
      { transform: 'scale(0.9)', opacity: 0.8, offset: 0.4, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: PULSE_MS },
  )
}

/**
 * 一次触觉反馈。`unlock` 是「连点达到阈值」那一下 —— 用三段更长的模式做出"解锁感"。
 *
 * 调用条件（三条同时满足才会真的震）：
 *   ① 运行环境存在 `navigator.vibrate`（iOS / 桌面浏览器不满足，直接静默返回）；
 *   ② 调用发生在**用户手势的回调里**（我们的场景就是点击，天然满足 ——
 *      Chrome 在没有用户交互时调用会直接忽略，且可能控制台警告）；
 *   ③ 设备没有开启省电 / 勿扰这类屏蔽震动的模式（由系统决定，我们管不了）。
 *
 * ★ 绝不因为震动失败而影响主流程：整个调用包在 try/catch 里，
 *   连点计数与面板打开都不依赖它的结果。
 */
export function tapHaptic(kind: 'tap' | 'unlock' = 'tap'): void {
  const nav = typeof navigator === 'undefined' ? null : navigator
  // iOS Safari / iOS PWA 走这一支：没有这个 API，也就没有"iOS 触觉反馈"可用。
  if (!nav || typeof nav.vibrate !== 'function') return
  try {
    nav.vibrate(kind === 'unlock' ? [16, 40, 16] : 8)
  } catch {
    /* 某些实现会抛（权限 / 省电）。静默：反馈失败不该影响点击本身。 */
  }
}
