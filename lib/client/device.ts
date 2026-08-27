// 注册时上报的设备标识（明文元数据，仅用于设置页区分是哪台设备；不涉及隐私敏感信息）
export function detectDeviceName(ua: string): string {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone'
  if (/Android/i.test(ua)) return 'Android'
  if (/Windows/i.test(ua)) {
    if (/Edg\//i.test(ua)) return 'Windows Edge'
    if (/Chrome\//i.test(ua)) return 'Windows Chrome'
    return 'Windows'
  }
  if (/Mac OS X|Macintosh/i.test(ua)) return 'Mac'
  return '其他'
}
