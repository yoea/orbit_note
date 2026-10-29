'use client'

// 批量选择态的勾选圈（列表页与归档页共用）。
//
// 18px，与详情页操作栏的图标同规格；未选中只画描边（不填色），列表里一眼能数出选了几个。
//
// ★ 选中态用**品牌紫**而不是「黑白反转」（浅色深底白勾 / 深色白底深勾）：
//   footnote-contrast 的 R2 禁止 dark:text-neutral-5xx 及更深，而那条守卫按 token 判、
//   看不到 dark:bg-white 这种上下文。与其为一个小圆点去放宽守卫，不如用一个不涉及
//   neutral 文字的配色 —— 顺带与全站的品牌渐变同一族。
export default function SelectDot({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-1 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors ${
        checked
          ? 'border-transparent bg-violet-500 text-white'
          : 'border-neutral-300 dark:border-neutral-600'
      }`}
    >
      {checked && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5">
          <path d="m5 13 4 4L19 7" />
        </svg>
      )}
    </span>
  )
}
