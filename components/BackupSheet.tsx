'use client'

import { useRef, useState } from 'react'
import ExportView from './ExportView'
import ImportView from './ImportView'

/**
 * 「导入与导出」抽屉（2026-10-29 用户要求：设置页点进去不再跳新页，改从底部弹出）。
 *
 * 为什么用抽屉而不是继续用整页：
 *   · 它是**设置里的一件事**，不是要去的地方。整页会把它抬到与「关于」「偏好」同级的位置，
 *     而且进去要"返回"一次、进来要"返回"一次，两步都是纯导航开销。
 *   · 抽屉可以随时下滑关掉（点遮罩 / 点关闭），人不会丢掉"我在设置里"的位置感。
 *   · 内容与原来完全一致（导入前、导出后；导出仍要再验一次身份）——**只换容器，不换流程**。
 *
 * 说明文字比整页版少（`compact`）：抽屉高度有限，长解释会把「选择文件 / 导出」按钮推到
 * 需要滚动才能看见的位置。信息密度让给操作，风险提示（导出含原始坐标）仍然保留。
 *
 * ★ /settings/backup 这个整页路由**保留**：书签、浏览器历史、已装的 PWA 深链都指向它。
 *   两者共用同一个 BackupRestoreView / ExportView / ImportView，不存在两套实现。
 */
export default function BackupSheet({ onClose }: { onClose: () => void }) {
  // 默认「导入」段：与整页版同一个理由（它更常用，也是分段里的第一个）
  const [mode, setMode] = useState<'export' | 'import'>('import')
  // 切换分段时把抽屉内容滚回顶部：两侧高度差很大，不重置会让人落在半截位置
  const scrollRef = useRef<HTMLDivElement>(null)

  function switchTo(next: 'export' | 'import') {
    setMode(next)
    scrollRef.current?.scrollTo({ top: 0 })
  }

  return (
    /* 遮罩铺满整屏、面板贴底：点遮罩关闭（与其它弹窗一致）。
       z-50 与全站弹窗同一层，`rounded-t-2xl` 表示"从底下抽出来的"。
       ★ 高度**固定 70% 屏高**（2026-10-29 用户要求，原来是 `max-h` 自适应）：
         固定的好处是切「导入 / 导出」时段落长度差很多，面板却不会跟着忽高忽低 ——
         抽屉的顶边稳定，人的视线不用重新找。内容超出就在面板内部滚（下面那层
         `overflow-y-auto`，不是整页滚）。
       ★ 宽度**与应用容器同宽**（2026-10-29 用户要求桌面端别铺满整屏）：
         面板 `mx-auto w-full max-w-md` —— `max-w-md` 与设置页 `SettingsView` 的
         内容容器是同一个值（两边内容都吃 `px-5` ⇒ 文字边界严格对齐）；手机上
         `w-full` 仍然满屏（`max-w-md` = 448px > 常见 390~430px 屏宽），观感不变。
         遮罩仍是整屏（点左右两侧的暗区关闭，与其它弹窗一致）。 */
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        className="mx-auto flex h-[70dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="导入与导出"
      >
        {/* 抓手：给"可以下滑/点外面关掉"一个视觉暗示（不做手势实现——那只会在
            内层可滚区域上打架，点遮罩已经够用） */}
        <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-neutral-300 dark:bg-neutral-600" />

        <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-2">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">导入与导出</h2>
          <button onClick={onClose} className="-mr-1 px-1 text-sm text-neutral-500 active:opacity-60 dark:text-neutral-400">
            关闭
          </button>
        </div>

        {/* 分段切换：与整页版逐字同源（iOS 灰底 + 选中项浮白），导入在前、导出在后 */}
        <div role="tablist" aria-label="导入与导出" className="mx-5 flex shrink-0 gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-900">
          {([['import', '导入'], ['export', '导出']] as const).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={mode === id}
              onClick={() => switchTo(id)}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${mode === id ? 'bg-white text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 内容区：内部滚动（全局 CSS 已给 `.overflow-y-auto` 加了 overscroll-behavior: contain，
            滑到底不会把手势传给页面）。`pb-safe` 躲开 Home 指示条。 */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-safe">
          {mode === 'export'
            ? <ExportView compact onDone={onClose} />
            : <ImportView compact />}
        </div>
      </div>
    </div>
  )
}
