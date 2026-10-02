'use client'

import { useEffect } from 'react'
import UnlockPrompt from '@/components/UnlockPrompt'
import TabBar from '@/components/TabBar'
import OfflineBadge from '@/components/OfflineBadge'
import { useRequireUnlock } from '@/lib/client/use-require-unlock'
import { initOfflineSync } from '@/lib/client/offline'

// 主应用区（登录后可访问的页面）共享布局：
//
// 1) 统一解锁守卫。此前 `/`、`/diary`、`/settings`、`/entry/[id]` 各自写一遍
//    useRequireUnlock，现在收敛到一处。放在 layout 还有个好处：同一路由组内切换
//    tab 时 layout 不会重新挂载，解锁检查不会每次重跑。
// 2) 底部 TabBar。route group 不改变 URL，所以 proxy.ts 的 matcher 与
//    proxy-guard.ts 的 protectedPaths 都无需改动。
//
// 布局：外层 wrapper 用 flex-1 + min-h-0 把可用高度限制成「容器高度 − TabBar 高度」，
// 页面在其中各自负责滚动（本项目页面都是容器滚动）。TabBar 走流内而非 fixed——
// 不遮挡内容，也不需要给每个页面补偿 padding。
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { state, retryUnlock } = useRequireUnlock()

  // 解锁完成 → 初始化离线同步（注册 online 监听 + 冲刷上次离线保存的队列；模块级单例）
  useEffect(() => {
    if (state === 'ready') initOfflineSync()
  }, [state])

  // 连接失败：原先只有 `/` 页面处理这个状态，/diary 与 /settings 会静默显示空白占位。
  // 收敛到 layout 后三个页面都能给出提示。
  if (state === 'error') {
    return (
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 pb-safe">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">连接失败，请检查网络后重试</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-6 py-3 text-sm font-medium text-white"
        >
          重试
        </button>
      </main>
    )
  }

  // 未解锁：只显示解锁提示，不渲染 TabBar（避免把用户带去同样需要解锁的页面）
  if (state === 'need-unlock') return <UnlockPrompt onUnlock={retryUnlock} />
  if (state !== 'ready') return <main className="flex-1 min-h-0 px-5 safe-pt" />

  return (
    <>
      {/* 离线指示：断网时顶部悬浮的琥珀色 wifi-off 圆标（在线时不渲染）。
          位置按页面自适应空位（见 OfflineBadge），悬浮不占内容空间 */}
      <OfflineBadge />
      {/* 顶部安全区：**不滚动 + 实色底**（2026-10-02 三轮修的最终形态）。
          三轮的过程与结论，别再走回头路：
          · 第一轮把 safe-pt 从各页面的滚动容器挪到这里（**透明**块）——没修好：
            透明块等于没给顶栏任何可采样的东西。
          · 第二轮改成 **sticky + 实色**——仍然没修好，而且引入了新现象（滚动后虚化重现）。
            原因见 globals.css 里 `.safe-pt` 的注释：顶栏在「文档滚动过」之后转为
            **合成它下面那层的真实像素**；而 sticky 元素本身带背景，恰好会被系统顶栏当作
            采样/合成对象，把它卷进这条链路。固定/粘性元素在顶边缘**不该自带背景色**
            （Safari 26 的已知行为：顶边缘的 fixed/sticky 元素会被顶栏读取并合成）。
          · 本轮：占位块回到**普通流内块 + 实色底**，把「盖住顶栏」这件事交给
            `.safe-pt` 的高度（触屏有下限、浏览器模式再多让一条 Safari 顶栏）。
            实色底仍然是必须的：那一层必须是一整块纯色，玻璃合成它才不会显形。 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 bg-white safe-pt dark:bg-neutral-950" aria-hidden />
        {/* 页面淡入**只挂在这里**，不要挂到各页面自己的根节点上（2026-09-30 修复）。
            原因：TabBar 的三个目的地是三个不同的 page 组件，切换时会**卸载/重新挂载**；
            动画类挂在页面根节点上时每次切换都会重放一遍 0.3s 的 opacity 0 → 1，
            用户看到的就是「每切一次都白屏闪一下」。而本 layout 在同一路由组内**不会重新挂载**
            （(app) 下所有页面共享它），所以挂在这里等于「整个应用就绪时淡入一次」，
            之后切 tab 是瞬时的。
            加在 children 包裹层而不是 TabBar：底部导航栏不该跟着淡入；
            也不含上面那层安全区占位（那是空白的，没有淡入的必要）。
            顺带：这也让首屏淡入与「解锁完成」对齐（state !== 'ready' 时渲染的是空占位，
            内容真正出现就是在这一支开始渲染的那一刻）。 */}
        <div className="animate-fade-in flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
      <TabBar />
    </>
  )
}
