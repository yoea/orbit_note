'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getDek } from '@/lib/client/session'
import { decryptEntries, fetchAllEntries } from '@/lib/client/entries'
import { buildCsv, buildJournalFile, JOURNAL_JSON_NAME, serializeJournal } from '@/lib/client/journal-format'
import { getAllEntryViewCounts } from '@/lib/client/views'
import { createZip } from '@/lib/client/zip'
import { verifyWithPasskey, verifyWithRecoveryKey } from '@/lib/client/verify'
import { BRAND_GRADIENT_CLASS, PRIMARY_BUTTON_CLASS } from '@/lib/client/ui'
import { useUserName } from '@/lib/client/use-user-name'

type ExportFormat = 'json-zip' | 'json' | 'csv'

// 三种格式各自的价值，写清楚免得用户选错：
// - JSON 压缩包（.zip）：**主推**。Day One / Journey 能直接导入，也是本应用能再导入回来的格式
//   （唯一支持"导出 → 再导入"往返无损的格式）。zip 内固定放 Journal.json，符合 Day One 的目录约定。
// - JSON（.json）：同样的内容，单文件，给只想要一个文件或要写脚本处理的人。
// - CSV：给 Excel / 表格用户，字段扁平可读，但**不能导回本应用**（也没有日记 App 认它）。
//
// ★ 措辞（2026-09-30 统一）：全流程只用「导出 / 导入」一个词根。这里刻意**不再叫「备份包」**——
//   功能名、页标题、分段、按钮、提示都已是「导出与导入」，「备份」只会又造出第二套叫法。
//   「这份文件是你的备份」这层意思由面板正文承担（"重新导入即完整恢复"）。
//   守卫 tests/export-terms.test.ts 会拦回退。
const EXPORT_FORMATS: { id: ExportFormat; label: string; hint: string; ext: string }[] = [
  { id: 'json-zip', label: 'JSON 压缩包（.zip）', hint: '推荐：Day One / Journey 可直接导入，也能导回本应用', ext: 'zip' },
  { id: 'json', label: 'JSON 文件（.json）', hint: '同上内容，单文件，便于自己写脚本处理', ext: 'json' },
  { id: 'csv', label: 'CSV 表格（.csv）', hint: '给 Excel 看，字段扁平；不能导回本应用', ext: 'csv' },
]

// 导出面板：验证身份（通行密钥或恢复密钥二选一）→ 拉取全部密文 → 客户端解密 →
// 生成 JSON 压缩包 / JSON / CSV 下载。明文只在本地生成，不上传服务器。
//
// 它**不是整页**：页头与「导出 / 导入」分段切换由 BackupRestoreView 提供（点击入口只有一个，
// 页面内再分两侧）。这里因此没有 <main> 与返回箭头。
//
// 「删除所有数据」曾经挂在本组件底部——那是个错位：本组件的语义是"导出"，而它是"不可逆销毁"。
// 已抽成 WipeDataAction，挂在设置页「数据」组的「危险操作」折叠里，勿搬回来
// （tests/settings-structure.test.ts 守着）。
//
// ★ 字段承诺：导出的是「全部笔记数据」——每一条的每个字段都要在文件里，导入后能完整恢复。
//   字段台账见 journal-format.ts 的 ENTRY_COLUMN_COVERAGE，由 tests/journal-fields.test.ts
//   拿 schema.ts 的真实列名对账（新增列忘了导出会直接红）。打开次数是本机字段，也随文件走。
export default function ExportView() {
  const router = useRouter()
  const [verified, setVerified] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [format, setFormat] = useState<ExportFormat>('json-zip')
  // 导出成功后的返回倒计时（明文文件已下载，提示谨慎保存并自动返回设置页释放内存）
  const [countdown, setCountdown] = useState(0)
  const userName = useUserName()

  // 文件名（本地日期，与下载一致）
  const now = new Date()
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const ext = EXPORT_FORMATS.find((f) => f.id === format)!.ext
  const fileName = `orbit-export-${stamp}.${ext}`

  async function verifyPasskey() {
    setBusy(true); setError(null)
    try {
      if (await verifyWithPasskey()) {
        setVerified(true)
      } else {
        setError('身份验证未完成')
      }
    } finally {
      setBusy(false)
    }
  }

  async function verifyRecovery() {
    if (!recoveryKey.trim()) return
    setBusy(true); setError(null)
    try {
      if (await verifyWithRecoveryKey(recoveryKey.trim())) {
        setVerified(true)
      } else {
        setError('恢复密钥验证失败')
      }
    } finally {
      setBusy(false)
    }
  }

  // 导出成功后：10 秒倒计时自动返回设置页（组件卸载 → 解密数据与页面状态全部释放）。
  // 倒计时初值在导出成功处与 setExported 一起设置，这里只负责走秒——
  // 避免在 effect 里同步 setState（react-hooks/set-state-in-effect）。
  useEffect(() => {
    if (exported == null) return
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(t)
          router.replace('/settings')
          return 0
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [exported, router])

  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  // 拉取全部条目（分页循环）→ 解密 → 按选择的格式组装并下载
  async function runExport() {
    const dek = getDek()
    if (!dek) return
    setExporting(true); setError(null)
    try {
      // 拉取 + 逐条解密与搜索弹窗共用同一套逻辑（lib/client/entries.ts），避免分页约定各自演化。
      // 保持服务端顺序（createdAt 倒序）。
      const all = await decryptEntries(dek, await fetchAllEntries())
      // 打开次数是**本机**数据（不在服务器上，见 lib/client/views.ts），所以要单独读一次带进文件。
      const viewCounts = await getAllEntryViewCounts()

      if (format === 'csv') {
        // 列集合与转义都在 journal-format.ts（纯函数，逐列取值 ⇒ 加列忘了给值 typecheck 会报错）
        download(new Blob([buildCsv(all, viewCounts)], { type: 'text/csv;charset=utf-8' }), fileName)
      } else {
        const json = serializeJournal(buildJournalFile(all, { viewCounts }))
        if (format === 'json') {
          download(new Blob([json], { type: 'application/json;charset=utf-8' }), fileName)
        } else {
          // zip 内固定放 Journal.json（Day One / Journey 的导入器认这个名字与位置）。
          // 不建空的 photos/ 目录：本应用没有媒体，塞空目录只会让导入方多问一句。
          const zip = createZip([{ name: JOURNAL_JSON_NAME, data: new TextEncoder().encode(json) }])
          download(new Blob([zip], { type: 'application/zip' }), fileName)
        }
      }

      setCountdown(10)
      setExported(all.length)
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败，请重试')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <p className="mt-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
        将{userName ? `${userName}的` : ''}全部日记导出为 <span className="font-medium">JSON 压缩包</span>（默认）或 CSV 表格。
        JSON 采用标准 Day One 结构，<span className="font-medium">Day One、Journey 都能直接导入</span>，也能重新导回本应用。
      </p>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
        正文以加密状态存储，导出时在本地解密——明文只在你设备上生成下载，不会上传服务器。
      </p>
      {/* 「全部字段」是承诺，得让用户看得见（否则恢复时才发现少了东西） */}
      <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
        含每条日记的<span className="font-medium">全部字段</span>：正文、创建与修改时间、坐标与地点名、定位精度、天气、时区、字数与打开次数；重新导入即完整恢复。
      </p>
      {/* 坐标不模糊是刻意的决策（模糊会损失数据），但必须显式告知后果 */}
      <p className="mt-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
        ⚠️ 导出文件含<span className="font-medium">未经模糊的原始坐标与地点名</span>（精确到米）。
        任何拿到该文件的人都能还原你去过哪里，请勿放进公共网盘或随手转发。
      </p>

      {!verified ? (
        <>
          {/* 验证阶段：导出是"把全部明文带出设备"，所以比导入多一道身份验证。
              这个不对称是刻意的——另一侧（导入）不验，并在那里写明了原因 */}
          <p className="mt-4 text-sm font-medium text-neutral-800 dark:text-neutral-200">先验证身份（二选一）</p>
          <div className="mt-2 flex flex-col gap-3">
            <button
              onClick={() => void verifyPasskey()}
              disabled={busy}
              className={`${PRIMARY_BUTTON_CLASS} ${BRAND_GRADIENT_CLASS}`}
            >
              {busy ? '正在验证…' : '使用通行密钥验证'}
            </button>
            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
              <span className="text-xs text-neutral-500 dark:text-neutral-400">或</span>
              <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
            </div>
            <input
              value={recoveryKey}
              onChange={(e) => setRecoveryKey(e.target.value)}
              placeholder="输入恢复密钥"
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-base outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
            <button
              onClick={() => void verifyRecovery()}
              disabled={busy || !recoveryKey.trim()}
              className="w-full rounded-xl border border-neutral-300 py-3 text-sm font-medium text-neutral-700 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300"
            >
              {busy ? '正在验证…' : '使用恢复密钥验证'}
            </button>
            {error && <p className="text-center text-sm text-red-500">{error}</p>}
          </div>
        </>
      ) : (
        <>
          {/* 验证通过：选格式 → 下载 */}
          <p className="mt-4 text-sm font-medium text-emerald-600 dark:text-emerald-400">✓ 身份已验证</p>

          <p className="mt-4 text-xs font-medium text-neutral-500 dark:text-neutral-400">导出格式</p>
          <ul className="mt-2 divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-neutral-50/60 dark:divide-neutral-800 dark:bg-neutral-900/40">
            {EXPORT_FORMATS.map((f) => (
              <li key={f.id}>
                <button
                  onClick={() => setFormat(f.id)}
                  aria-pressed={format === f.id}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left active:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block text-sm text-neutral-800 dark:text-neutral-200">{f.label}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">{f.hint}</span>
                  </span>
                  <span className={`shrink-0 text-sm ${format === f.id ? 'text-emerald-600 dark:text-emerald-400' : 'text-transparent'}`}>✓</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-4 rounded-2xl border border-neutral-100 bg-neutral-50/60 px-4 py-3.5 dark:border-neutral-800 dark:bg-neutral-900/40">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">导出文件</p>
            <p className="mt-1 break-all font-mono text-sm text-neutral-800 dark:text-neutral-200">{fileName}</p>
          </div>
          <button
            onClick={() => void runExport()}
            disabled={exporting}
            className={`mt-4 ${PRIMARY_BUTTON_CLASS} ${BRAND_GRADIENT_CLASS}`}
          >
            {exporting ? '解密导出中…' : '下载导出的文件'}
          </button>
          {exported != null && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                已导出 {exported} 篇，文件已开始下载
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                文件为解密后的明文，且含未经模糊的坐标。请谨慎保存，避免留在公共设备上。
              </p>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                {countdown} 秒后自动返回设置页
              </p>
            </div>
          )}
          {exported != null && (
            <button
              onClick={() => router.replace('/settings')}
              className="mt-3 w-full rounded-2xl border border-neutral-200 py-3.5 text-sm font-medium text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
            >
              立即返回设置
            </button>
          )}
          {error && <p className="mt-2 text-center text-sm text-red-500">{error}</p>}
        </>
      )}
    </div>
  )
}
