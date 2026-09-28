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
