// 全宽主操作按钮的样式（单一来源）。
//
// 为什么单独抽出来：写页「保存」（DiaryEditor）与详情页编辑态「保存修改」（EntryView）
// 曾经各写一份 class 串，结果内边距（py-3.5 / py-4）与禁用态（opacity-30 / opacity-50）
// 双双漂移，相邻两个页面的主按钮一个高一个矮、灰得也不一样。抽成常量后改一处即两处生效，
// 并有 tests/primary-button.test.ts 守着不许再在组件里手写。
//
// 约定：
// - 高度 = py-4（上下各 16px）+ 正文 16px 字号（body 默认，父容器不得改字号）⇒ 视觉高度一致；
// - 禁用态统一 opacity-50——全站 11 处用 50，是最普遍的取值（原先写页的 opacity-30 是唯一孤例）；
// - 按下 scale-[0.99] 给触感反馈；只用 transition-colors 过渡颜色（saved 态会切底色），
//   不用 Tailwind 的 transition 简写——它会把 backdrop-filter 一并列进过渡属性，
//   与本项目「零模糊类属性」的约定冲突。
export const PRIMARY_BUTTON_CLASS =
  'w-full rounded-2xl py-4 font-medium text-white transition-colors active:scale-[0.99] disabled:opacity-50'

// 品牌渐变底色：与 TabBar 选中态、偏好开关 ON、头像同一套 token。
export const BRAND_GRADIENT_CLASS = 'bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500'

// 正文编辑区 `<textarea>` 的共用核心样式（写页 AutoTextarea 与详情页编辑态 EntryView）。
//
// 为什么收敛成常量：两处都是「编辑一篇 Markdown 正文」，字号必须与查看页一致，
// 否则同一段文字在写页和查看页的行宽/换行位置不同——用户要的「所见即所得」就断了。
// 事实是它漂移过：写页写 `text-lg`（18px），详情页编辑态写 `text-base`（16px），
// 而查看页 Markdown 容器是 `text-base` ⇒ 写页在骗人（2026-09-30 用户指出）。
//
// **字号 = text-base（16px）= components/Markdown.tsx 的 qo-markdown 容器**，三处同源。
// 别改回 text-lg：那会让查看页的换行位置与编辑页不一致。
//
// 各调用方只加自己的差异部分：
//   · AutoTextarea   → 加 `overflow-y-auto` 与 placeholder 配色（写页有占位文案）
//   · EntryView 编辑态 → 加 `mt-3`（工具条与输入框之间的间距）
// tests/editor-textarea.test.ts 守着：两端都必须引这个常量、都必须 text-base、都不许 text-lg。
export const EDITOR_TEXTAREA_CLASS =
  'min-h-0 w-full flex-1 resize-none bg-transparent text-base leading-relaxed outline-none disabled:opacity-60'

// iOS Alert 风格弹窗底部「只有一个关闭动作」的整宽按钮（完成 / 取消 / 返回列表）。
// 单一来源，四个单按钮弹窗（PrefsDialog / AboutDialog / PasskeysDialog /
// RecoveryRegenerateDialog）共用；tests/dialog-footer.test.ts 守着不许再手写。
//
// ★ 为什么必须带 w-full（2026-09-30 真实事故，用户反馈「关于的完成按钮显示异常」）：
//   弹窗卡片有两种写法——
//     · PrefsDialog 是 `flex flex-col`，按钮作为 flex item 被 align-items:stretch 拉满，
//       看起来永远正常；
//     · AboutDialog / PasskeysDialog / RecoveryRegenerateDialog 是**普通块级**卡片
//       （`w-full max-w-sm overflow-hidden rounded-2xl …`，没有 flex）。
//   块级容器里 <button> 的默认 display 是 inline-block ⇒ 宽度收缩到内容宽度，
//   于是「完成」两个字缩成一个小块贴在左边、文字偏左，而上面的 border-t 分隔线却是通长的
//   ——一眼就是「样式错乱」。w-full 在两种容器里都成立，别再依赖「父级恰好是 flex」。
//
// 其余取值与 ConfirmDialog 的双按钮行逐项相同：py-3.5 + text-base ⇒ 视觉高度约 52px。
// 不用 transition 简写（会把 backdrop-filter 拉进过渡属性），也不用任何模糊类。
export const DIALOG_FOOTER_BUTTON_CLASS =
  'w-full shrink-0 border-t border-neutral-200 py-3.5 text-base font-medium text-neutral-500 active:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:active:bg-neutral-700'
