// 安全复制：clipboard API 不可用/被拒时降级 execCommand，返回是否成功。
// 注意：`navigator.clipboard?.writeText(x).catch(...)` 在 clipboard 为 undefined 时会对
// undefined 调 .catch 抛 TypeError——必须整体 try/catch。
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 权限被拒或 API 异常：降级到 execCommand
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
