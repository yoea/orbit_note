import type { WrappedKeyRow } from './types'

/**
 * 恢复密钥的「辨认信息」：指纹 + 创建时间。
 *
 * ★ 完整恢复密钥只在生成时显示一次；界面上长期可见的只有这一对信息：
 *   · fingerprint = SHA-256(recovery key) 前 8 位（服务端已不下发完整哈希）
 *   · createdAt   = 当前这把密钥的创建时刻（换新时服务端刷新）
 *
 * 放在独立模块是���为**设置页与弹窗都要用同一套格式化** —— 两处各写一份的话，
 * 迟早会漂成「设置页显示 A3F9-2B7C、弹窗显示 a3f92b7c」这种不一致。
 */

export interface RecoveryKeyInfo {
  /** 「A3F9-2B7C」形式（8 位 hex，大写、4+4 分组） */
  fingerprint: string
  /** 「2026/10/29」形式（本地时区，只到天） */
  createdAt: string
}

/** 8 位 hex 指纹 → 「XXXX-XXXX」。纯展示格式，不可逆、不能反推密钥 */
export function formatRecoveryFingerprint(fp: string): string {
  return `${fp.slice(0, 4).toUpperCase()}-${fp.slice(4, 8).toUpperCase()}`
}

/** ISO 时间戳 → 「2026/10/29」（本地时区，只到天） */
export function formatRecoveryCreatedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

/** 从 wrappers 列表里取出恢复密钥的辨认信息；没有或字段缺失 ⇒ null */
export function recoveryInfoFromWrappers(wrappers: WrappedKeyRow[]): RecoveryKeyInfo | null {
  const rec = wrappers.find((w) => w.wrapperType === 'recovery')
  if (!rec?.recoveryKeyFingerprint || !rec.createdAt) return null
  return {
    fingerprint: formatRecoveryFingerprint(rec.recoveryKeyFingerprint),
    createdAt: formatRecoveryCreatedAt(rec.createdAt),
  }
}
