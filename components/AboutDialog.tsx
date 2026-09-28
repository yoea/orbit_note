'use client'

import OrbitLogo from './OrbitLogo'

// 关于弹窗：iOS Alert 风格居中卡片（内容可滚动），展示项目最值得了解的信息。
// 从设置页「关于 Orbit」项进入；遮罩点击或「完成」按钮关闭。
export default function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-8" onClick={onClose}>
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="关于 Orbit"
      >
        <div className="max-h-[70dvh] overflow-y-auto px-5 py-6">
          <div className="flex items-center justify-between">
            <OrbitLogo />
            {/* GitHub 项目地址：图标 + 版本文字整体可点击（新标签打开）；图标纯黑/纯白 */}
            <a
              href="https://github.com/yoea/orbit_note"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub 项目地址"
              className="flex items-center gap-1.5 active:opacity-60"
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current text-black dark:text-white" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
              <p className="text-xs tabular-nums text-neutral-400">
                版本 {process.env.NEXT_PUBLIC_VERSION ?? 'dev'}
                {process.env.NEXT_PUBLIC_COMMIT_ID && process.env.NEXT_PUBLIC_COMMIT_ID !== 'unknown' && (
                  <span> · {process.env.NEXT_PUBLIC_COMMIT_ID}</span>
                )}
              </p>
            </a>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
            端到端加密的私人日记，只为一个人服务。
          </p>
          <ul className="mt-4 divide-y divide-neutral-100 dark:divide-neutral-800">
            {[
              { icon: '🔑', title: '通行密钥登录', desc: '无密码，指纹 / Face ID / Windows Hello 等' },
              { icon: '🔐', title: '恢复密钥', desc: '通行密钥丢失时找回数据' },
              { icon: '✍️', title: '随手即写', desc: '无格式、无标题，打开就写' },
              { icon: '🔥', title: '习惯养成', desc: '连续天数、每日提示、去年今日' },
            ].map((f) => (
              <li key={f.title} className="flex items-start gap-3 py-2.5 first:pt-1 last:pb-1">
                <span className="mt-px text-base leading-5">{f.icon}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{f.title}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">{f.desc}</p>
                </div>
              </li>
            ))}
          </ul>
          {/* 第三方服务：数据流向透明（定位是浏览器原生能力，不列第三方） */}
          <div className="mt-4 rounded-xl bg-neutral-50/60 px-3 py-2.5 dark:bg-neutral-900/40">
            <p className="text-[10px] font-medium text-neutral-400">第三方服务</p>
            <p className="mt-1 text-[10px] leading-relaxed text-neutral-400">
              BigDataCloud（地点名）· 和风天气（实时天气）<br />
              调用时坐标会发送给对应服务
            </p>
          </div>
          {/* 版权行从原全局页脚搬来：页脚已由底部 TabBar 取代，版权声明不能随之丢失。
              颜色与登录页的版本页脚保持一致：不能用 text-neutral-300 dark:text-neutral-600
              ——那一对是反的（浅色底上用浅灰 ≈1.5:1、深色底上用深灰 ≈2.5:1），10px 小字等于看不见。 */}
          <p className="mt-4 text-center text-[10px] text-neutral-500 dark:text-neutral-400">
            © 2026 {process.env.NEXT_PUBLIC_COPYRIGHT_NAME ?? 'Orbit'}
          </p>
        </div>
        <div className="border-t border-neutral-200 p-3 dark:border-neutral-700">
          <button
            onClick={onClose}
            className="w-full rounded-xl py-2.5 text-base font-medium text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-700"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
