'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import ExportView from './ExportView'
import ImportView from './ImportView'

// 备份与恢复页（/settings/backup）：把「导出笔记」与「导入笔记」收进同一个入口。
//
// 为什么合并：两者是同一件事的两端（备份出去 / 恢复回来），用户的心智是"把我的日记搬走"
// 或"把备份拿回来"，而不是"导出功能"和"导入功能"。设置页里分成两行会让它们看起来无关，
// 而它们本质上是一对。合并后设置页「数据」组从三行降到两行（另一行是「删除所有数据」）。
//
// 为什么用分段切换而不是上下堆叠：两个操作流的步数差得多——导出是"验证 → 下载"两步，
// 导入是"选文件 → 预览 → 导入 → 看报告"四步。堆叠会让页面很长，且导入的报告区被推到
// 整个导出区下方，导入完要滚很久才看到结果。分段切换让两侧各自独占版面。
//
// 状态：切换分段会卸载另一侧组件，因此**导出侧的"已验证身份"状态不会跨切换保留**。
// 这是刻意的（敏感操作的授权不该长期残留），代价是误切后要多验一次。
export default function BackupRestoreView() {
  const [mode, setMode] = useState<'export' | 'import'>('export')
  const mainRef = useRef<HTMLElement>(null)

  // 切换后滚回顶部：两侧内容高度不同，不重置会让用户落在半截位置
  function switchTo(next: 'export' | 'import') {
    setMode(next)
    mainRef.current?.scrollTo({ top: 0 })
  }

  return (
    <main ref={mainRef} className="mx-auto h-full w-full max-w-md overflow-y-auto px-5 pb-4 safe-pt">
      {/* viewTransitionName：页面切换动画中页头保持固定（空间锚点） */}
      <header className="page-header relative flex items-center justify-between py-3">
        {/* iOS 原生风格返回：chevron 箭头（原生路由返回，右滑手势同样生效）；标题绝对居中 */}
        <Link href="/settings" aria-label="返回" className="-ml-1 px-1 text-2xl leading-none text-neutral-500 dark:text-neutral-400">
          ‹
        </Link>
        <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold">备份与恢复</h1>
        <span className="w-8" />
      </header>

      {/* 分段切换：iOS 风格（灰底 + 选中项浮白）。用 role=tablist 让读屏能识别这是二选一 */}
      <div role="tablist" aria-label="备份与恢复" className="flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
        <button
          role="tab"
          aria-selected={mode === 'export'}
          onClick={() => switchTo('export')}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${mode === 'export' ? 'bg-white text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}`}
        >
          导出
        </button>
        <button
          role="tab"
          aria-selected={mode === 'import'}
          onClick={() => switchTo('import')}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${mode === 'import' ? 'bg-white text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}`}
        >
          导入
        </button>
      </div>

      {mode === 'export' ? <ExportView /> : <ImportView />}
    </main>
  )
}
