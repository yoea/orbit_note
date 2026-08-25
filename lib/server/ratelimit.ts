// 单用户系统的内存滑动窗口限流。生产单实例即可；如多实例需换共享存储。
const windows = new Map<string, number[]>()

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const arr = (windows.get(key) ?? []).filter((t) => now - t < windowMs)
  if (arr.length >= max) {
    windows.set(key, arr)
    return false
  }
  arr.push(now)
  windows.set(key, arr)
  return true
}
