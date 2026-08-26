// Orbit 品牌 LOGO：轨道环（行星/轨道意象，呼应 "Orbit" 命名）+ 渐变粗体文字。
// 用于首页标题、登录页、解锁页。
export default function OrbitLogo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const ring = size === 'lg' ? 'h-9 w-9' : 'h-7 w-7'
  const sat = size === 'lg' ? 'h-3 w-3' : 'h-2.5 w-2.5'
  const core = size === 'lg' ? 'h-2 w-2' : 'h-1.5 w-1.5'
  const text = size === 'lg' ? 'text-3xl' : 'text-2xl'

  return (
    <span className="inline-flex select-none items-center gap-2">
      {/* 轨道环：圆环 + 轨道上的卫星点 + 中心星核 */}
      <span className={`relative inline-flex ${ring} items-center justify-center`} aria-hidden>
        <span className="absolute inset-0 rounded-full border-[2.5px] border-orange-500/70" />
        <span className={`absolute -right-0.5 -top-0.5 rounded-full bg-orange-500 shadow-sm ${sat}`} />
        <span className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-900 dark:bg-neutral-100 ${core}`} />
      </span>
      <span className={`bg-gradient-to-r from-orange-600 via-rose-500 to-violet-600 bg-clip-text font-black tracking-tight text-transparent ${text}`}>
        Orbit
      </span>
    </span>
  )
}
