// 日期跳转的纯函数（列表页「定位到某一天」用）。
//
// 为什么单独成文件：跨月补位、闰年、跨年这些边界在组件里没法单测，
// 而它们恰好是日历最容易错的地方（2月29日、12月→次年1月、月初不在周一）。
// 这里全部是纯函数、无副作用，UI 只负责渲染与回调。
//
// ★ 时区口径：**一律本地时区**，与列表分组（DiaryListView 的 dayLabel）和热力图
//   （ContributionHeatmap 的 iso）严格一致。不引入 UTC/Intl 时区参数——
//   一处按 UTC 归日、另一处按本地归日，就会出现「日历上点 9月2日，列表却定位到 9月3日」
//   这种只在晚上十点后复现的错位。

/** 本地时区的一天，`yyyy-mm-dd` */
export type DayKey = string

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Date → DayKey（本地时区） */
export function dayKeyOf(d: Date): DayKey {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * DayKey → 本地零点的 Date；非法返回 null。
 *
 * 为什么要回验组件：`new Date(2026, 1, 30)`（2月30日）不会报错，会静默滚到 3月2日。
 * 日历只吃我们自己生成的 key，但导入的备份、手改的 URL 参数都可能塞进来，
 * 与其信任输入不如回验一次。
 */
export function parseDayKey(key: DayKey): Date | null {
  const m = DAY_RE.exec(key)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(y, mo - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null
  return date
}

/**
 * 锚定查询用的边界：本地当天 23:59:59.999 的 ISO 串。
 *
 * 服务端的 `before` 参数按 `created_at < before` 取「比它更早的条目」，
 * 所以「定位到 9月2日」= `before = 9月2日 23:59:59.999`（**含当天**）。
 * 用本地时区构造是有意的：列表按本地日期分组，用户说的「9月2日」就是本地的那一天。
 */
export function dayEndIso(key: DayKey): string | null {
  const d = parseDayKey(key)
  if (!d) return null
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

/** 月份位移（month 为 1-12），跨年自动进位 */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zero = year * 12 + (month - 1) + delta
  return { year: Math.floor(zero / 12), month: (zero % 12 + 12) % 12 + 1 }
}

/**
 * 月历网格：**周一为首列**、**固定 6 行 × 7 列**（不足补 null）。
 *
 * 固定 6 行是有意的：按真实周数返回会让 5 行的月份与 6 行的月份切换时弹窗高度跳动，
 * 而本项目对「布局跳版」一贯敏感（同「打开次数图标恒渲染」的取舍）。
 * 非本月的格子返回 null 而不是相邻月份日期——避免「点了一个显示 8月31日 的格子，
 * 结果跳到了 8 月」的歧义。
 */
export function monthGrid(year: number, month: number): (DayKey | null)[][] {
  const first = new Date(year, month - 1, 1)
  const dayCount = new Date(year, month, 0).getDate()
  // 周一为 0：getDay() 是周日为 0，所以整体前移一天再取模
  const lead = (first.getDay() + 6) % 7
  const cells: (DayKey | null)[] = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= dayCount; d++) cells.push(dayKeyOf(new Date(year, month - 1, d)))
  while (cells.length < 42) cells.push(null)
  const rows: (DayKey | null)[][] = []
  for (let i = 0; i < 42; i += 7) rows.push(cells.slice(i, i + 7))
  return rows
}

/** '2026年9月' */
export function monthTitle(year: number, month: number): string {
  return `${year}年${month}月`
}

/**
 * 锚定条的日期文案：今天 / 9月2日 / 2025年9月2日（跨年才带年份）。
 * today 显式传入便于测试（默认取当前时间）。
 */
export function jumpDayLabel(key: DayKey, today: DayKey = dayKeyOf(new Date())): string {
  if (key === today) return '今天'
  const d = parseDayKey(key)
  if (!d) return key
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === new Date(`${today}T00:00:00`).getFullYear() ? md : `${d.getFullYear()}年${md}`
}
