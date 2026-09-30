'use client'

// 正文编辑的「工具条 + 预览切换」接线（纯客户端状态，无渲染）。
//
// 抽出来的原因：写页（DiaryEditor）与详情页编辑态（EntryView）是同一件事的两处实现——
// 都要给 <textarea> 加 Markdown 工具条、都能切「预览」看渲染结果。这段接线里有两个
// 容易写错又很难肉眼发现的细节（选区还原、预览滚动定位），各写一份必然漂移：
// 事实上详情页编辑态一开始就漏掉了整条工具条（用户举报的 bug）。两处共用这一份后，
// 组件层只剩下「渲染 textarea 还是渲染预览」。UI 部分见 components/MarkdownToolbar.tsx。
//
// 调用方契约：editorRef 必须挂到真实 <textarea> 上，previewRef 必须挂到预览容器上——
// 选区只存在于真实 DOM 节点（受控 value 替代不了），预览滚动要读容器自身的几何。

import { useLayoutEffect, useRef, useState } from 'react'
import { lineAtOffset, pickScrollTop, toggleLinePrefix, toggleWrap, type ToolbarAction } from './markdown'

export function useMarkdownEditor({ text, applyText }: {
  /** 当前正文（Markdown 源码）。用来算插入结果与光标所在行 */
  text: string
  /** 工具条改动正文的唯一出口：调用方在这里同步自己的 state / ref / 草稿 */
  applyText: (next: string) => void
}) {
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState(false)
  // 待还原的选区：工具条插入标记后，必须等 React 把新 value 刷进 DOM 再设选区，
  // 否则会被 value 更新重置到末尾。
  const pendingSelectionRef = useRef<[number, number] | null>(null)
  // 预览滚动定位：切到预览**之前**记下光标所在行（textarea 随后会被卸载，那之后就取不到
  // selectionStart 了），预览挂载后的 layout effect 消费它并清空。
  const pendingPreviewLineRef = useRef<number | null>(null)

  // 用 layout effect 而不是 rAF——前者严格在 DOM 变更后、绘制前执行，顺序确定。
  useLayoutEffect(() => {
    const sel = pendingSelectionRef.current
    if (!sel) return
    pendingSelectionRef.current = null
    const el = editorRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(sel[0], sel[1])
  }, [text])

  // 预览滚动定位（编辑态 → 预览态的位置同步）。
  //
  // 原来的缺陷：编辑区是 <textarea> 自己的滚动（scrollTop 在 textarea 上），预览是另一个
  // 新挂载的 <div overflow-y-auto>——两个不同节点、没有任何位置传递 ⇒ 新节点 scrollTop = 0，
  // 光标在文末也会从文档顶部开始显示。
  //
  // 定位方式：渲染侧给每个顶层块写了 data-qo-line（源码起始行号），这里取「行号 ≤ 光标行」
  // 的最后一个块，把它对到视口顶部。
  // 边界：光标在第 1 行 → 命中首块、scrollTop = 0；光标在末尾 → 目标块靠后，浏览器会把
  // scrollTop 钳到最大值（自然贴底，不需要特判）；空文档 → 预览只有占位文案、没有
  // data-qo-line ⇒ pickScrollTop 收到空列表返回 0。
  useLayoutEffect(() => {
    if (!preview) return
    const el = previewRef.current
    const line = pendingPreviewLineRef.current
    pendingPreviewLineRef.current = null
    if (!el || line == null) return
    const containerTop = el.getBoundingClientRect().top
    const blocks = Array.from(el.querySelectorAll<HTMLElement>('[data-qo-line]'))
      .map((n) => ({
        line: Number(n.getAttribute('data-qo-line')),
        // rect 是视口坐标：减容器顶部 = 相对可视区顶部；再加 scrollTop = 相对内容顶部
        top: n.getBoundingClientRect().top - containerTop + el.scrollTop,
      }))
      .filter((b) => Number.isFinite(b.line))
    el.scrollTop = pickScrollTop(blocks, line)
  }, [preview])

  // 切换编辑 / 预览。光标行必须在 setPreview **之前**读——textarea 一旦卸载就取不到选区了。
  function togglePreview() {
    if (!preview) {
      pendingPreviewLineRef.current = lineAtOffset(text, editorRef.current?.selectionStart ?? 0)
    }
    setPreview((p) => !p)
  }

  // 工具条动作：读当前选区 → 纯函数变换 → 落回正文
  function applyToolbar(action: ToolbarAction) {
    const el = editorRef.current
    if (!el) return
    const { selectionStart, selectionEnd } = el
    const result = action.kind === 'wrap'
      ? toggleWrap(text, selectionStart, selectionEnd, action.marker)
      : toggleLinePrefix(text, selectionStart, selectionEnd, action.marker)
    if (result.text === text) return
    pendingSelectionRef.current = [result.selStart, result.selEnd]
    applyText(result.text)
  }

  return { editorRef, previewRef, preview, setPreview, togglePreview, applyToolbar }
}
