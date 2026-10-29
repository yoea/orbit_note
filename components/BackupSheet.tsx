'use client'

import { useRef, useState } from 'react'
import ExportView from './ExportView'
import ImportView from './ImportView'
import { useDialogBehavior } from '@/lib/client/dialog'

/**
 * 「导入与导出」容器（2026-10-29 用户要求：设置页点进去不再跳新页，改从底部弹出）。
 *
 * ★ 响应式**两种形态、一棵 DOM**（2026-10-29 第二轮：桌面端"抽屉贴着底边、两侧大暗区"
 *   看着像另一个应用）：
 *     < 768px（手机 / 窄窗口）→ 底部**抽屉**：贴底、固定 70dvh、顶部圆角 + 抓手
 *     ≥ 768px（`md:`）      → 居中**模态窗**：垂直水平居中、高度随内容、四周圆角、无抓手
 *   切换**纯 CSS 断点**，不引 JS 媒体查询：SSR 首帧不知道视口宽度，JS 方案必然先渲染
 *   一种形态再纠正（闪一下），还要监听 resize；CSS 断点零 JS、缩放窗口时实时跟随。
 *   两种形态共用**同一棵内容树**（分段 + ExportView / ImportView），只是外层容器的
 *   几个类名按断点分叉 —— 不拆成两个组件，免得同一份交互在两处漂移。
 *
 *   为什么断点取 768 而不是 1024：抽屉是「贴屏幕边缘抽出」的语义。内容列固定
 *   `max-w-md`(448px)，在 768px 窗口里两侧已各留 160px 暗区、却仍贴着底边 —— 正是
 *   从这里开始显丑。1024 才切的话，768~1024 整段（iPad 竖屏、小笔记本、分屏）仍是那个
 *   别扭形态。
 *
 *   桌面形态的高度策略与 PrefsDialog 同一路子：**限高挂在内容区自己身上**
 *   （`md:max-h-[60dvh]`），不给面板写 `max-h` + 内容 `flex-1` —— 面板高度为 auto 时
 *   `flex-1`（basis 0）的伸缩结果靠不住，内容自己限高才是本项目已验证的写法。
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
  // 面板本体：Esc（栈式，只关最上层）/ Tab 循环 / 焦点归还统一入口。
  // ★ 两个子面板内部都没有嵌套遮罩（ExportView / ImportView 都只是表单），
  //   所以 Esc 的语义唯一 = 关掉整个容器，不会误伤内层。
  const panelRef = useRef<HTMLDivElement>(null)
  useDialogBehavior(panelRef, onClose)

  function switchTo(next: 'export' | 'import') {
    setMode(next)
    scrollRef.current?.scrollTo({ top: 0 })
  }

  return (
    /* 遮罩铺满整屏（点遮罩关闭，与其它弹窗一致），z-50 与全站弹窗同一层。
       两种形态只差外层容器的对齐与面板的圆角 / 高度，**面板内的一切完全相同**：

       手机（默认）    : `flex-col justify-end` ⇒ 面板贴底；`rounded-t-2xl` + 抓手
                        表示"从底下抽出来的"
       桌面（`md:`）   : `md:items-center md:justify-center` ⇒ 面板垂直水平居中
                        （仍是 flex-col：竖向 justify=垂直、items=水平，不用改方向）；
                        `md:rounded-2xl` 四周圆角、`md:shadow-xl` 与 PrefsDialog 同族；
                        `md:p-6` 给面板四周留出暗区，窄窗口下也不会贴边

       ★ 高度：**手机固定 70dvh、桌面随内容**（`md:h-auto`）
         手机固定的好处是切「导入 / 导出」时段落长度差很多，面板却不会跟着忽高忽低 ——
         抽屉的顶边稳定，人的视线不用重新找。桌面没有"从边缘抽出"的语义，跟着内容
         收缩才不像一块空盒子；内容过长由下面那层自己限高内滚（不是整页滚）。
       ★ 宽度**与应用容器同宽**（2026-10-29 用户要求桌面端别铺满整屏）：
         面板 `mx-auto w-full max-w-md` —— `max-w-md` 与设置页 `SettingsView` 的
         内容容器是同一个值（两边内容都吃 `px-5` ⇒ 文字边界严格对齐）；手机上
         `w-full` 仍然满屏（`max-w-md` = 448px > 常见 390~430px 屏宽），观感不变。
         遮罩仍是整屏（点面板外的暗区关闭，与其它弹窗一致）。 */
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 md:items-center md:justify-center md:p-6" onClick={onClose}>
      <div
        ref={panelRef}
        className="mx-auto flex h-[70dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white dark:bg-neutral-800 md:h-auto md:rounded-2xl md:shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="导入与导出"
      >
        {/* 抓手：给"可以下滑/点外面关掉"一个视觉暗示（不做手势实现——那只会在
            内层可滚区域上打架，点遮罩已经够用）。
            ★ 只在抽屉形态出现（`md:hidden`）：居中模态窗不是"从边缘抽出来的"，
              那根小横条在那里没有语义，只会像一条多余的装饰。 */}
        <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-neutral-300 dark:bg-neutral-600 md:hidden" />

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
              aria-controls="backup-panel"
              onClick={() => switchTo(id)}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${mode === id ? 'bg-white text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 内容区：内部滚动（全局 CSS 已给 `.overflow-y-auto` 加了 overscroll-behavior: contain，
            滑到底不会把手势传给页面）。`pb-safe` 躲开 Home 指示条（桌面端 env 为 0，
            退化成 1rem 的下留白，正好）。

            ★ 两种形态的限高方式不同，但都是本项目已验证的写法：
              手机  `flex-1`：撑满面板那固定的 70dvh，多余的在内部滚
              桌面  `md:flex-initial md:max-h-[60dvh]`：面板高度随内容 ⇒ 改由**内容自己限高**
                    （与 PrefsDialog 的开关列表同一路子）。这里刻意**不**写
                    「面板 md:max-h + 内容 flex-1」—— 面板高度为 auto 时 `flex-1`
                    （basis 0）能分到多少是不确定的，容易塌成 0 高。 */}
        <div
          id="backup-panel"
          role="tabpanel"
          aria-label="导入与导出内容"
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-5 pb-safe md:flex-initial md:max-h-[60dvh]"
        >
          {mode === 'export'
            ? <ExportView compact onDone={onClose} />
            : <ImportView compact />}
        </div>
      </div>
    </div>
  )
}
