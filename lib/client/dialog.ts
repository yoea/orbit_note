'use client'

import { useEffect, useRef, type RefObject } from 'react'

/**
 * 弹窗统一行为（2026-10-29 桌面端无障碍 + 统一 Esc 关闭）。
 *
 * 一个 hook 同时管四件事：
 *   1. **Esc 关闭（栈式）**：所有弹窗共享一个全局栈，window 上只有一个 keydown 监听，
 *      Esc 只调**栈顶**那一个 ⇒ 多层叠加时一次只关最上层（弹窗 A 里再开确认框 B，
 *      Esc 先关 B；再按一次才关 A）。早先 BackupSheet / Popconfirm 各自挂监听的写法
 *      在叠层时会一次关掉多层，已全部迁移到本 hook。
 *   2. **初始焦点**：挂载时若焦点还留在背景（触发按钮上），聚焦卡内第一个可聚焦元素；
 *      自带 autoFocus 输入框的弹窗（焦点已在卡内）不会被改动。
 *   3. **Tab 循环**：焦点始终留在弹窗卡内（`aria-modal` 的键盘面）。Tab 由同一个全局
 *      监听分发：从栈顶向下找**第一个包含当前焦点的容器**来处理 —— 叠层弹窗在本项目
 *      里互为兄弟节点，焦点只会属于其中一个容器，不会互相抢。
 *   4. **关闭归还焦点**：卸载时把焦点还给打开前的触发元素（仍在文档里才还）。
 *
 * ★ 约定：弹窗组件**只在打开时被条件渲染**（本项目全部如此），active 恒为 true；
 *   常驻挂载、用 open prop 控制的（Popconfirm）传 `{ active: open }`。
 * ★ 容器 ref 必须指向**卡片/面板本体**（不是遮罩）——Tab 循环与初始焦点都以它为界。
 *   卡片被条件换掉再挂回来（AboutDialog 开隐藏面板时）也没关系：容器在事件发生时
 *   才从 ref 取，不依赖挂载那一刻的 DOM。
 */

const FOCUSABLE_SELECTOR =
  'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

type DialogEntry = {
  containerRef: RefObject<HTMLElement | null>
  getOnEsc: () => void
}

const stack: DialogEntry[] = []
let listening = false

function onWindowKeydown(e: KeyboardEvent) {
  const top = stack[stack.length - 1]
  if (!top) return
  if (e.key === 'Escape' && !e.isComposing) {
    // 只关最上层（需求钉死：多层叠加一次只关一层）
    top.getOnEsc()
    return
  }
  if (e.key === 'Tab') {
    // 从栈顶向下找第一个「包含当前焦点」的容器：叠层弹窗互为兄弟，焦点只属于其一
    for (let i = stack.length - 1; i >= 0; i--) {
      const el = stack[i].containerRef.current
      if (el && el.contains(document.activeElement)) {
        trapTab(e, el)
        return
      }
    }
  }
}

function trapTab(e: KeyboardEvent, el: HTMLElement) {
  const focusables = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((n) => n.getClientRects().length > 0) // 排除 display:none / 未渲染的
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const cur = document.activeElement
  if (e.shiftKey) {
    if (cur === first) { e.preventDefault(); last.focus() }
  } else {
    if (cur === last) { e.preventDefault(); first.focus() }
  }
}

function ensureListener() {
  if (listening) return
  window.addEventListener('keydown', onWindowKeydown)
  listening = true
}

function removeListener() {
  if (!listening) return
  window.removeEventListener('keydown', onWindowKeydown)
  listening = false
}

export function useDialogBehavior(
  containerRef: RefObject<HTMLElement | null>,
  onEsc: () => void,
  opts: { active?: boolean } = {},
) {
  const { active = true } = opts
  // 回调经 ref 取最新：调用方传内联箭头函数时 effect 不会反复重挂（栈序稳定）
  const onEscRef = useRef(onEsc)
  useEffect(() => { onEscRef.current = onEsc })

  useEffect(() => {
    if (!active) return
    const entry: DialogEntry = { containerRef, getOnEsc: () => onEscRef.current() }
    stack.push(entry)
    ensureListener()

    // 初始焦点：焦点还留在背景（触发按钮）时移进卡内；已 autoFocus 的输入框不动
    const el = containerRef.current
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (el && (!document.activeElement || !el.contains(document.activeElement))) {
      el.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus()
    }

    return () => {
      const i = stack.indexOf(entry)
      if (i >= 0) stack.splice(i, 1)
      if (stack.length === 0) removeListener()
      // 归还焦点：还给打开前的触发元素（它得还在文档里；焦点本来就在卡内的
      // autoFocus 弹窗没有「触发元素」可还，跳过）
      if (prev && prev.isConnected && !(el && el.contains(prev))) prev.focus()
    }
    // ★ 依赖只有 active 与 containerRef：onEsc 刻意不进依赖（它经 onEscRef 取最新），
    //   否则调用方传内联箭头函数时 effect 每次渲染都重挂 ⇒ Esc 栈顺序被搅乱。
  }, [active, containerRef])
}
