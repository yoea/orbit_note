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
            <p className="text-xs tabular-nums text-neutral-400">
              版本 {process.env.NEXT_PUBLIC_VERSION ?? 'dev'}
              {process.env.NEXT_PUBLIC_COMMIT_ID && process.env.NEXT_PUBLIC_COMMIT_ID !== 'unknown' && (
                <span> · {process.env.NEXT_PUBLIC_COMMIT_ID}</span>
              )}
            </p>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
            端到端加密的私人日记，只为一个人服务。
          </p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-400">
            数据只属于你——服务器永远看不到你的文字。
          </p>
          <ul className="mt-4 divide-y divide-neutral-100 dark:divide-neutral-800">
            {[
              { icon: '🔑', title: '通行密钥登录', desc: '无密码，指纹 / Face ID / Windows Hello 等' },
              { icon: '🛡️', title: '端到端加密', desc: '正文只在设备本地加解密，服务器仅存密文' },
              { icon: '🔐', title: '恢复密钥', desc: '通行密钥丢失，用恢复密钥仍可找回数据' },
              { icon: '📍', title: '位置记录', desc: '可选保存坐标与时区，随时可以移除' },
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
          <p className="mt-4 text-center text-[10px] text-neutral-400">© 2026 Orbit</p>
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
