// 归档页要用的纯函数（放在 lib 里以便真单测：组件内联函数测不到边界）。
//
// 「归档于 X 天前」与通行密钥弹窗里的「添加于 X 天前」是同一个口径：
// **按自然日算，只比年月日、不比时刻**。为什么必须是自然日：
// 23:59 归档、00:01 打开归档页，用户直觉是「刚才」，按 24 小时差算会显示「1 天前」。
//
// 说明：PasskeysDialog 里有一份等价实现（那份的语义是「添加于」，两个词义不同、
// 不共用；若以后出现第三处「X 天前」，就把它抽到这里并同步改那两处）。
export function daysAgoLabel(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  // 用 round 而不是 floor：夏令时那天是 23 / 25 小时，floor 会把「昨天」算成「今天」
  const days = Math.round((dayStart(now) - dayStart(then)) / 86_400_000)
  // 负数（归档时间在未来：设备时钟乱 / 脏数据）按「今天」处理，不显示「-3 天前」
  if (days <= 0) return '今天'
  return `${days} 天前`
}
