'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getDek } from '@/lib/client/session'
import { importJournalFile, readJournalText, type ImportProgress, type ImportReport } from '@/lib/client/import'
import { parseJournal, type RejectedEntry } from '@/lib/client/journal-format'
import { BRAND_GRADIENT_CLASS, PRIMARY_BUTTON_CLASS } from '@/lib/client/ui'
import { useOffline } from '@/lib/client/use-offline'

// 被拒条目的展示上限：全列出来会把页面撑爆，超出部分只给计数（完整原因已在提示里说明）
const SHOW_REJECTED = 20

interface Preview {
  fileName: string
  ok: number
  rejected: RejectedEntry[]
  warnings: string[]
}

const PHASE_LABEL: Record<ImportProgress['phase'], string> = {
  reading: '读取文件',
  parsing: '解析条目',
  encrypting: '本地加密',
  uploading: '上传入库',
  refreshing: '刷新本地缓存',
  done: '完成',
}

// 导入笔记页（/settings/import）：选择 JSON 备份包（.zip/.json）→ 本地解析预览 → 逐条加密上传。
//
// 与导出页的差异（刻意）：**不做二次身份验证**。导出是"把全部明文带出设备"，所以要再验一次身份；
// 导入是"把文件写进自己账号"，解锁态已经是本人，多验一次只是添麻烦。
//
// 幂等：同一份文件导入两次不会翻倍——条目 id 由源标识确定性派生（UUIDv5），
// 服务端 ON CONFLICT DO NOTHING 直接跳过已存在的，报告里体现为「已存在，跳过」。
export default function ImportView() {
  const offline = useOffline()
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [reading, setReading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onPick(f: File | null) {
    setReport(null)
    setProgress(null)
    setError(null)
    setPreview(null)
    setFile(f)
    if (!f) return
    setReading(true)
    try {
      const text = await readJournalText(f)
      const parsed = await parseJournal(JSON.parse(text))
      setPreview({ fileName: f.name, ok: parsed.entries.length, rejected: parsed.rejected, warnings: parsed.warnings })
    } catch (e) {
      setError(e instanceof Error ? e.message : '文件解析失败')
      setFile(null)
    } finally {
      setReading(false)
    }
  }

  async function runImport() {
    if (!file) return
    const dek = getDek()
    if (!dek) {
      setError('未解锁，无法导入')
      return
    }
    setImporting(true); setError(null); setReport(null)
    try {
      const r = await importJournalFile({ file, dek, onProgress: setProgress })
      setReport(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败，请重试')
    } finally {
      setImporting(false)
      setProgress(null)
    }
  }

  const sizeMb = file ? (file.size / 1024 / 1024).toFixed(1) : null
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null

  return (
    <main className="mx-auto h-full w-full max-w-md overflow-y-auto px-5 pb-4 safe-pt">
      <header className="page-header relative flex items-center justify-between py-3">
        <Link href="/settings" aria-label="返回" className="-ml-1 px-1 text-2xl leading-none text-neutral-500 dark:text-neutral-400">
          ‹
        </Link>
        <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold">导入笔记</h1>
        <span className="w-8" />
      </header>

      <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
        导入本应用导出的 <span className="font-medium">JSON 备份包（.zip / .json）</span>，
        以及 <span className="font-medium">Day One、Journey</span> 导出的日记文件。
      </p>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
        导入是<span className="font-medium">合并</span>而不是覆盖：已有的日记不受影响；同一条重复导入会被跳过（按条目内容确定性识别）。
        文件在你设备上解密并重新加密后才上传，服务器拿到的仍是密文。
      </p>

      {offline && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          离线模式暂不可用：导入需要把条目写入服务器。请联网后再试。
        </p>
      )}

      {/* 选择文件 */}
      <input
        ref={fileRef}
        type="file"
        accept=".json,.zip,application/json,application/zip"
        className="hidden"
        disabled={offline || importing}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null
          e.target.value = '' // 允许再次选择同一个文件（否则 onChange 不触发）
          void onPick(f)
        }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={offline || importing || reading}
        className="mt-4 w-full rounded-2xl border border-neutral-300 py-3.5 text-sm font-medium text-neutral-700 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300"
      >
        {reading ? '解析中…' : file ? '重新选择文件' : '选择备份文件'}
      </button>

      {file && (
        <div className="mt-3 rounded-2xl border border-neutral-100 bg-neutral-50/60 px-4 py-3.5 dark:border-neutral-800 dark:bg-neutral-900/40">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">已选文件</p>
          <p className="mt-1 break-all font-mono text-sm text-neutral-800 dark:text-neutral-200">{file.name}</p>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{sizeMb} MB</p>
        </div>
      )}

      {preview && (
        <div className="mt-3 rounded-2xl border border-neutral-100 px-4 py-3.5 dark:border-neutral-800">
          <p className="text-sm text-neutral-800 dark:text-neutral-200">
            可导入 <span className="font-medium">{preview.ok}</span> 篇
            {preview.rejected.length > 0 && <>，跳过 <span className="font-medium">{preview.rejected.length}</span> 篇</>}
          </p>
          {preview.warnings.map((w) => (
            <p key={w} className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">· {w}</p>
          ))}
          {preview.rejected.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {preview.rejected.slice(0, SHOW_REJECTED).map((r, i) => (
                <li key={`${r.ref}-${i}`} className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                  · {r.ref}：{r.reason}
                </li>
              ))}
              {preview.rejected.length > SHOW_REJECTED && (
                <li className="text-xs text-neutral-500 dark:text-neutral-400">
                  · 还有 {preview.rejected.length - SHOW_REJECTED} 篇被跳过（原因同上）
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {preview && !report && (
        <button
          onClick={() => void runImport()}
          disabled={importing || offline || preview.ok === 0}
          className={`mt-4 ${PRIMARY_BUTTON_CLASS} ${BRAND_GRADIENT_CLASS}`}
        >
          {importing ? '导入中…' : `导入 ${preview.ok} 篇`}
        </button>
      )}

      {/* 进度：总条数可能上千，只报「阶段 + 已完成/总数」与一根细进度条 */}
      {importing && progress && (
        <div className="mt-3 rounded-2xl border border-neutral-100 px-4 py-3.5 dark:border-neutral-800">
          <p className="text-sm text-neutral-800 dark:text-neutral-200">
            {PHASE_LABEL[progress.phase]}
            {progress.total > 0 && <span className="ml-2 tabular-nums text-neutral-500 dark:text-neutral-400">{progress.done}/{progress.total}</span>}
          </p>
          {percent != null && (
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div className={`h-full ${BRAND_GRADIENT_CLASS}`} style={{ width: `${percent}%` }} />
            </div>
          )}
        </div>
      )}

      {report && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900 dark:bg-emerald-950">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
            {report.aborted ? '导入已中断' : '导入完成'}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-emerald-700 dark:text-emerald-300">
            新增 {report.imported} 篇
            {report.existing > 0 && <>，已存在跳过 {report.existing} 篇</>}
            {report.rejected.length > 0 && <>，跳过 {report.rejected.length} 篇</>}
            ，文件共 {report.total} 篇
          </p>
          {report.warnings.map((w) => (
            <p key={w} className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">· {w}</p>
          ))}
          {report.rejected.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {report.rejected.slice(0, SHOW_REJECTED).map((r, i) => (
                <li key={`${r.ref}-${i}`} className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                  · {r.ref}：{r.reason}
                </li>
              ))}
              {report.rejected.length > SHOW_REJECTED && (
                <li className="text-xs text-emerald-700 dark:text-emerald-300">
                  · 还有 {report.rejected.length - SHOW_REJECTED} 篇未导入
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {report && (
        <div className="mt-3 flex flex-col gap-2">
          <button
            onClick={() => router.push('/diary')}
            className="w-full rounded-2xl border border-neutral-200 py-3.5 text-sm font-medium text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
          >
            去看日记列表
          </button>
          <button
            onClick={() => router.replace('/settings')}
            className="w-full rounded-2xl border border-neutral-200 py-3.5 text-sm font-medium text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
          >
            返回设置
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-center text-sm text-red-500">{error}</p>}
    </main>
  )
}
