#!/usr/bin/env node
// 部署前置检查：生产库 schema 是否已跟上 drizzle/*.sql
//
// 为什么需要：deploy.sh / update.sh 都不跑迁移，全靠人记得先手动执行。
// 漏掉的表现是「代码上线了但表/列不存在」→ 相关接口 500，而且没有明显报错，
// 很难第一时间反应过来（本项目已经踩过一次）。这里把它变成部署前的硬失败。
//
// 分工：ssh 与数据库查询由 deploy.sh（bash）完成并把结果写进临时文件，
// 本脚本只负责「解析迁移 + 比对」。
// 原因：本机 Node 的 child_process 在受限环境里 spawn 会 EBUSY（实测连 node/git 都起不来），
// 所以绝不能在脚本内部再起 ssh。
//
// 解析规则（按语句出现顺序应用，后出现的 DROP 会抵消先前的 CREATE/ADD）：
//   CREATE TABLE "x" (...)              → 建表 + 各列
//   ALTER TABLE "x" ADD COLUMN "y"      → 加列
//   ALTER TABLE "x" DROP COLUMN "y"     → 删列
//   DROP TABLE "x"                      → 删表
// 只覆盖本项目迁移的写法；某文件解析不出任何 schema 语句会打印警告（避免静默放过）。
//
// 用法：node scripts/check-schema.mjs <实际schema文件>
//   <实际schema文件> 每行一条 "table.column"（可由 scripts/schema-dump.sh 产出）

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const drizzleDir = join(projectDir, 'drizzle')
const actualFile = process.argv[2]
if (!actualFile) {
  console.error('❌ 用法：node scripts/check-schema.mjs <实际schema文件>')
  process.exit(1)
}

// ---------- 1) 按语句顺序解析迁移 → 期望的 table -> Set(column) ----------
const expected = new Map()
const warns = []
const migrateFiles = readdirSync(drizzleDir).filter((f) => f.endsWith('.sql')).sort()

for (const file of migrateFiles) {
  const sql = readFileSync(join(drizzleDir, file), 'utf8')
  const events = []

  for (const m of sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"([a-z_][a-z0-9_]*)"\s*\(([\s\S]*?)\n\);/gi)) {
    const cols = []
    for (const line of m[2].split('\n')) {
      const c = /^\s*"([a-z_][a-z0-9_]*)"/.exec(line)
      if (c) cols.push(c[1])
    }
    events.push({ at: m.index, kind: 'create', table: m[1], cols })
  }
  for (const m of sql.matchAll(/ALTER TABLE\s+"([a-z_][a-z0-9_]*)"\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"([a-z_][a-z0-9_]*)"/gi)) {
    events.push({ at: m.index, kind: 'addCol', table: m[1], col: m[2] })
  }
  for (const m of sql.matchAll(/ALTER TABLE\s+"([a-z_][a-z0-9_]*)"\s+DROP COLUMN(?:\s+IF EXISTS)?\s+"([a-z_][a-z0-9_]*)"/gi)) {
    events.push({ at: m.index, kind: 'dropCol', table: m[1], col: m[2] })
  }
  for (const m of sql.matchAll(/DROP TABLE(?:\s+IF EXISTS)?\s+"([a-z_][a-z0-9_]*)"(?!\s*;)/gi)) {
    events.push({ at: m.index, kind: 'dropTable', table: m[1] })
  }

  events.sort((a, b) => a.at - b.at)
  for (const e of events) {
    if (e.kind === 'create') {
      if (!expected.has(e.table)) expected.set(e.table, new Set())
      for (const c of e.cols) expected.get(e.table).add(c)
    } else if (e.kind === 'addCol') {
      if (!expected.has(e.table)) expected.set(e.table, new Set())
      expected.get(e.table).add(e.col)
    } else if (e.kind === 'dropCol') {
      expected.get(e.table)?.delete(e.col)
    } else if (e.kind === 'dropTable') {
      expected.delete(e.table)
    }
  }

  if (events.length === 0) {
    warns.push(`${file} 未解析出建表/加列/加删语句（若该迁移只涉及索引或约束，可忽略）`)
  }
}

const totalExpected = [...expected.values()].reduce((n, cols) => n + cols.size, 0)
if (totalExpected === 0) {
  console.warn('⚠️  未能从 drizzle/*.sql 解析出任何 schema 信息，跳过检查')
  process.exit(0)
}
console.log(`迁移期望：${expected.size} 张表 / ${totalExpected} 列（来自 ${migrateFiles.length} 个迁移文件）`)
for (const w of warns) console.warn(`⚠️  ${w}`)

// ---------- 2) 读取实际 schema ----------
const actual = new Set(
  readFileSync(actualFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean),
)
if (actual.size === 0) {
  console.error('❌ 实际 schema 为空——生产库连接或查询可能失败，中止部署。')
  process.exit(1)
}
console.log(`生产库实际：${actual.size} 列`)

// ---------- 3) 比对 ----------
const missingTables = []
const missingColumns = []
for (const [table, cols] of [...expected].sort()) {
  const hasTable = [...actual].some((a) => a.startsWith(`${table}.`))
  if (!hasTable) {
    missingTables.push(table)
    continue
  }
  for (const col of cols) {
    if (!actual.has(`${table}.${col}`)) missingColumns.push(`${table}.${col}`)
  }
}

if (missingTables.length === 0 && missingColumns.length === 0) {
  console.log('✅ 生产库 schema 已跟上所有迁移')
  process.exit(0)
}

console.error('')
console.error('❌ 生产库 schema 落后于 drizzle/*.sql，已中止部署。')
if (missingTables.length) console.error(`   缺表：${missingTables.join(', ')}`)
if (missingColumns.length) console.error(`   缺列：${missingColumns.join(', ')}`)
console.error('')
console.error('   处理方式：先在服务器执行缺失的迁移，再重新部署。')
process.exit(1)
