'use client'

// 自动解锁失败后的手动解锁入口（留在当前页，用户手势下 Face ID 正常）
export default function UnlockPrompt({ onUnlock }: { onUnlock: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 safe-pb">
      <h1 className="text-2xl font-semibold text-neutral-800 dark:text-neutral-100">Orbit</h1>
      <button
        onClick={onUnlock}
        className="w-full max-w-xs rounded-2xl bg-neutral-900 px-6 py-4 text-base font-medium text-white active:scale-[0.98] dark:bg-neutral-100 dark:text-neutral-900"
      >
        使用 Face ID 解锁
      </button>
    </main>
  )
}
