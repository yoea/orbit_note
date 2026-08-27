import 'server-only'
import { and, isNotNull, lt } from 'drizzle-orm'
import { db } from './db'
import { credentials, diaryEntries, drafts, keyWrappers } from './db/schema'

// 删除冷静期：软删标记后 180 秒内可撤销，超时由 purge 物理删除。
// 状态存数据库而非进程内存——PM2 重启/部署不丢标记，无需任务队列/定时器：
// 任何请求触发惰性清理（purgeExpiredWipes），另有服务器 crontab 每分钟兜底，
// 即使删除后用户不再访问，数据也会在冷静期后 1 分钟内被物理清除。
export const WIPE_GRACE_MS = 180_000

// 惰性清理：软删超过冷静期的数据物理删除（4 张表，数据量小，无条件全量执行）
export async function purgeExpiredWipes(): Promise<void> {
  const cutoff = new Date(Date.now() - WIPE_GRACE_MS)
  for (const table of [diaryEntries, drafts, keyWrappers, credentials]) {
    await db.delete(table).where(and(isNotNull(table.deletedAt), lt(table.deletedAt, cutoff)))
  }
}
