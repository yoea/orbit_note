// Orbit 品牌 LOGO：纯文字（渐变粗体），无图案元素——避免布局干扰。
export default function OrbitLogo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span
      className={`inline-block select-none bg-gradient-to-r from-orange-600 via-rose-500 to-violet-600 bg-clip-text font-black tracking-tight text-transparent ${
        size === 'lg' ? 'text-3xl' : 'text-2xl'
      }`}
    >
      Orbit
    </span>
  )
}
