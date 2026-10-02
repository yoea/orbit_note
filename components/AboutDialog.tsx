'use client'

import type { ReactNode } from 'react'
import OrbitLogo from './OrbitLogo'
import { DIALOG_FOOTER_BUTTON_CLASS } from '@/lib/client/ui'

// 关于弹窗：iOS Alert 风格居中卡片（内容可滚动），展示项目最值得了解的信息。
// 从设置页「关于 Orbit」项进入；遮罩点击或「完成」按钮关闭。
//
// ★ 排版约定（2026-09-30 重做）：
// - **卡片顶边一条 3px 品牌渐变**：全站「主色」只有这一条渐变（TabBar 选中态 / 主按钮 /
//   头像底 / 偏好开关 ON），放在顶边等于给弹窗签名——不占内容空间、不引入任何模糊属性。
// - **三段式层次**：Hero（是谁）→ 核心优势（3 条，图标底用同一条渐变强调）→ 更多特色
//   （2 列紧凑网格，弱化为文字色）。层次靠「字号 + 图标底 + 间距」拉开，**不靠嵌套灰底卡**：
//   弹窗只有三层（遮罩 → 卡片 → 内容/底栏），卡片本身只有 384px 宽，再套圆角灰卡只会更碎。
// - **文案一律单行**：关于页是「一眼扫过」的位置，不是说明书。亮点写结果、不写原理。
// - **高度预算**：滚动区 `max-h-[70dvh]`（与 PasskeysDialog / RecoveryRegenerateDialog 同）。
//   2026-10-02 做了一轮「更紧凑」（用户要求）：Hero 里的版本胶囊取消（版本移到页脚同一行）、
//   各段间距各收 4~8px、第三方说明精简成一句 —— 内容总高从约 563px 降到约 470px，
//   375×667 这类小屏也基本不用滚动。**加一行内容前先算总高**，否则常见机型会凭空多出滚动条。
// - 底栏沿用 DIALOG_FOOTER_BUTTON_CLASS（自带 w-full）——块级卡片里漏了它，按钮会缩成
//   两个字宽贴在左边（rc6 真实事故，见 tests/dialog-footer.test.ts）。
//
// 颜色一律走 AA 配对 `text-neutral-500 dark:text-neutral-400`：tests/footnote-contrast.test.ts
// 是 token 级守卫（浅色端不得 ≤400、深色端不得 ≥500、不得叠透明度 /50）。

// 图标语言与 TabBar / SearchIcon 一致：Feather/Lucide —— 24 网格、stroke 2、圆头圆角。
function Svg({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  )
}

type IconProps = { className?: string }

const ShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
)

const KeyIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </Svg>
)

const CloudOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m2 2 20 20" />
    <path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193" />
    <path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5" />
  </Svg>
)

const FlameIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  </Svg>
)

const HistoryIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l4 2" />
  </Svg>
)

const GridIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
  </Svg>
)

const PenIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Svg>
)

const MapPinIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </Svg>
)

const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5" />
    <path d="M12 15V3" />
  </Svg>
)

// 核心优势：写「用户得到什么」，不写实现。三条覆盖隐私 / 登录 / 可用性，
// 恰好对应这款应用与普通日记 App 的三处分野。
const HIGHLIGHTS: { Icon: (p: IconProps) => ReactNode; title: string; desc: string }[] = [
  { Icon: ShieldIcon, title: '端到端加密', desc: '正文在本地加密，服务器只存密文' },
  { Icon: KeyIcon, title: '通行密钥登录', desc: '无密码，指纹或面容一键进入' },
  { Icon: CloudOffIcon, title: '离线可用', desc: '没网也能写、也能翻看' },
]

// 更多特色：只留名词，一行一个。格子里不放描述——扫一眼就够。
const MORE = [
  { Icon: FlameIcon, label: '连续天数' },
  { Icon: HistoryIcon, label: '去年今日' },
  { Icon: GridIcon, label: '写作热力图' },
  { Icon: PenIcon, label: '草稿不丢' },
  { Icon: MapPinIcon, label: '地点天气' },
  { Icon: DownloadIcon, label: '导出导入' },
]

export default function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-8" onClick={onClose}>
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="关于 Orbit"
      >
        {/* 品牌渐变态（与 TabBar 选中态 / 主按钮 / 头像底同一条）。放在滚动区之外，
            滚动时始终留在卡片顶边。 */}
        <div className="h-[3px] w-full bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500" />

        <div className="thin-scrollbar max-h-[70dvh] overflow-y-auto">
          {/* Hero：品牌字标 + 一句话定位。上下内边距刻意比其他弹窗紧：整卡要能在一屏内放完
              （见文件头「高度预算」）。
              ★ 2026-10-02 起 Hero 里**不再有版本胶囊**——用户要求「版本号移到底部与版权、
              开源说明同一行」，GitHub 入口随之搬到页脚那一行（少一个胶囊 = 少约 36px 高度，
              这是本次「更紧凑」里最大的一笔）。 */}
          <div className="px-6 pb-3 pt-4 text-center">
            <OrbitLogo size="lg" />
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">端到端加密的私人日记</p>
          </div>

          <p className="px-6 pb-1 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">核心优势</p>
          {/* 三行强调项：图标底吃品牌渐变（全站主色的唯一来源），与下方「更多特色」的裸图标拉开层级。
              divide 分隔线内缩在 px-6 之内（行自身不加左右 padding），视觉上更收敛。 */}
          <ul className="divide-y divide-neutral-100 px-6 dark:divide-neutral-800">
            {HIGHLIGHTS.map(({ Icon, title, desc }) => (
              <li key={title} className="flex items-center gap-3 py-2">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 via-rose-400 to-violet-500 text-white">
                  <Icon className="h-[19px] w-[19px]" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{title}</p>
                  <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{desc}</p>
                </div>
              </li>
            ))}
          </ul>

          <p className="px-6 pb-1.5 pt-3 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">更多特色</p>
          {/* 两列网格：图标与文字同色（继承 li 的 currentColor），比逐个上色更干净。 */}
          <ul className="grid grid-cols-2 gap-x-3 gap-y-2 px-6">
            {MORE.map(({ Icon, label }) => (
              <li key={label} className="flex items-center gap-2 text-neutral-600 dark:text-neutral-300">
                <Icon className="h-4 w-4 shrink-0" />
                <span className="text-xs">{label}</span>
              </li>
            ))}
          </ul>

          {/* 页脚：数据流向透明 + 版本 / 版权 / 开源同一行（2026-10-02 用户要求更紧凑）。
              · 版本号从 Hero 的胶囊移到这里，GitHub 入口跟着搬过来（作为行首的文本链接）；
              · 第三方说明精简成一句（原文点名了 BigDataCloud 与和风天气，太长）；
              · 颜色沿用 AA 配对——neutral-300/600 那一对是**反向**的（浅色底用浅灰 ≈1.5:1），
                10px 小字在手机上等于看不见。 */}
          <div className="mt-4 border-t border-neutral-100 px-6 pb-3 pt-3 dark:border-neutral-800">
            <p className="text-[10px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              地名与天气来自第三方服务，查询时会发送坐标。
            </p>
            <p className="mt-1.5 text-[10px] text-neutral-500 dark:text-neutral-400">
              <a
                href="https://github.com/yoea/orbit_note"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub 项目地址"
                className="active:opacity-60"
              >
                GitHub
              </a>
              <span className="mx-1">·</span>
              {/* 版本号本身**已带 "v" 前缀**（来自 git tag，如 v1.18.1）——模板里不能再补一个 v，
                  否则渲染成 "vv1.18.1"（2026-09-30 用户反馈）。 */}
              {process.env.NEXT_PUBLIC_VERSION ?? 'dev'}
              <span className="mx-1">·</span>
              © 2026 {process.env.NEXT_PUBLIC_COPYRIGHT_NAME ?? 'Orbit'}
              <span className="mx-1">·</span>
              MIT 开源
            </p>
          </div>
        </div>

        <button onClick={onClose} className={DIALOG_FOOTER_BUTTON_CLASS}>
          完成
        </button>
      </div>
    </div>
  )
}
