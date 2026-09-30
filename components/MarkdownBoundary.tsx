'use client'

import { Component, type ReactNode } from 'react'

// Markdown 渲染兜底边界。
//
// 为什么需要它（2026-09-30，用户反馈「离线点开部分笔记无反应、无法查看」的排查结论之一）：
// 正文在查看态**必须**经过 Markdown 渲染器。渲染器是本项目唯一的「把用户数据交给第三方
// 代码解析」的环节（react-markdown / remark），它的异常会一路冒到 app/error.tsx——
// 于是整页变成「页面出错了」，用户再也看不到那篇笔记的**一个字**。
// 对私人日记来说这是不可接受的：正文是用户唯一不可再生的东西，任何渲染层异常都应当
// 退化成「原文可读」，而不是「笔记不可查看」。
//
// 兜底内容刻意用 whitespace-pre-wrap 直接渲染 Markdown **源码**：这里展示的是源码而不是
// 渲染结果，换行必须原样保留（与 Markdown.tsx 里段落禁用 whitespace-pre 的原因相反——
// 那边处理的是 <br> 之后补出的 "\n"，这里处理的是源码本身）。
//
// 只兜渲染，不碰数据：不修改 plain、不发起任何请求、不写任何缓存。
export default class MarkdownBoundary extends Component<
  { source: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="text-base leading-relaxed text-neutral-800 dark:text-neutral-200">
          <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
            格式解析失败，下面是原文（内容没有被改动）
          </p>
          <p className="whitespace-pre-wrap break-words">{this.props.source}</p>
        </div>
      )
    }
    return this.props.children
  }
}
