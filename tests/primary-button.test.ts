import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 回归守卫：全宽主操作按钮（写页「保存」/ 详情页编辑态「保存修改」）必须共用
// lib/client/ui.ts 的 PRIMARY_BUTTON_CLASS。
//
// 背景（真实事故）：两个按钮原先各写一份 class 串，结果内边距（py-3.5 / py-4）与
// 禁用态（opacity-30 / opacity-50）双双漂移——相邻两个页面的主按钮一个高一个矮、
// 灰得也不一样，而且编译期完全不会报错（className 只是字符串，没有类型约束）。
//
// 以后谁在组件里重新手写这串，这个测试会直接失败并指出是哪个文件。

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8')
}

const CONSUMERS = ['components/DiaryEditor.tsx', 'components/EntryView.tsx']

describe('全宽主按钮样式单一来源', () => {
  it.each(CONSUMERS)('%s 从 lib/client/ui 引入常量', (file) => {
    const src = read(file)
    expect(src).toContain("from '@/lib/client/ui'")
    expect(src).toMatch(/PRIMARY_BUTTON_CLASS/)
  })

  it.each(CONSUMERS)('%s 不再手写全宽主按钮 class 串', (file) => {
    // 手写形态：w-full rounded-2xl … py-3 / py-3.5 / py-4 （宽度+圆角+内边距挤在一串里）
    expect(read(file)).not.toMatch(/w-full rounded-2xl[^`'"]*py-\d/)
  })

  it('常量本身保持高度与禁用态约定', () => {
    const src = read('lib/client/ui.ts')
    expect(src).toMatch(/py-4/) // 高度：上下各 16px，与 UnlockPrompt 等全宽主按钮一致
    expect(src).toMatch(/disabled:opacity-50/) // 禁用态：全站通用取值
  })
})
