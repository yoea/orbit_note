// 单用户系统的内存滑动窗口限流。生产单实例即可；如多实例需换共享存储。
// key 必须使用静态字符串（如 'login'、'diary:write'）；动态 key（含 IP/时间等）会导致 Map 无限增长。
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
