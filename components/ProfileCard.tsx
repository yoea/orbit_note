'use client'

import { useEffect, useRef, useState } from 'react'
import { useDiaryOverview } from '@/lib/client/diary-overview'
import { useProfile } from '@/lib/client/use-user-name'
import { USER_NAME_MAX, saveUserName } from '@/lib/client/profile'

// 个人信息卡片：生成式头像（名字首字符 + 品牌渐变）+ 名字 + 一行统计。
//
// ★ 2026-11-04 改造：**点名字就地改名**（与「通行密钥」里改设备名同款），不再弹窗。
//   弹窗那版要多点一层才能改一个字，与设备改名的手感不一致。
//   交互：点昵称 → 变输入框 + 右侧「✓ / ✕」；回车或 ✓ 保存，✕ 或 Esc 放弃。
//
// 约定：
//   · 卡片**整体不再可点**（原来整卡是 button，点哪儿都开弹窗）——只有昵称文字是按钮。
//   · 名字由 DEK 加密存服务器（lib/client/profile.ts 的 saveUserName），成功后写回缓存并
//     通知所有订阅者 ⇒ 本卡片、通行密钥标题、退出确认等处立即跟着变，无需刷新页面。
//   · **不提供「随机生成一个」**：默认名只属于 loadUserName 的懒创建（首次进需要名字的页面）。
//     tests/name-edit-guard.test.ts 守着这条。
//   · 离线（disabled）：点名字只弹提示，不进编辑态——改名是服务器写操作。
export default function ProfileCard({ disabled = false, onBlocked, onOpenAvatar }: {
  disabled?: boolean
  /** 离线时点了名字：上层用来弹「离线不可用」提示 */
  onBlocked?: () => void
  /** 点头像：上层打开头像管理（看大图 / 换图 / 删除） */
  onOpenAvatar?: () => void
}) {
  const { name, avatarUrl, avatarVersion } = useProfile()
  const stats = useDiaryOverview()

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 签名 URL 过期 / 网络失败时 <img> 会空着，这时退回首字母，别留一个破图
  const [imgFailed, setImgFailed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // 进入编辑：聚焦并**全选**（改名绝大多数是整体替换），只操作 DOM、不 setState。
  useEffect(() => {
    if (!editing) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [editing])

  // 只放「篇/天/字」：加上「始于 <日期>」在手机宽度下会被截断
  const parts: string[] = []
  if (stats) {
    parts.push(`${stats.count} 篇`)
    parts.push(`${stats.days} 天`)
    parts.push(`${stats.words.toLocaleString()} 字`)
  }
  const subtitle = parts.join(' · ')
  // 生成式头像：名字首字符（[...name] 展开，避免 emoji / 代理对被截成半个字符）
  const initial = name ? ([...name][0] ?? '·') : '·'

  function startEdit() {
    if (disabled) { onBlocked?.(); return }
    // 名字还没加载出来时不进编辑态（否则草稿是空串，一保存就把占位当成了真名）
    if (busy || !name) return
    setDraft(name)
    setError(null)
    setEditing(true)
  }

  /** 放弃：不写库、不提示，直接退回展示态（点叉号 / Esc / 失焦都走这里） */
  function cancelEdit() {
    setEditing(false)
    setDraft('')
    setError(null)
  }

  async function commitEdit() {
    const next = draft.trim()
    // 空名或没改：按放弃处理，不发请求
    if (!next || next === name) { cancelEdit(); return }
    setBusy(true)
    setError(null)
    try {
      await saveUserName(next) // 内部写缓存 + 通知订阅者，全站名字立即刷新
      setEditing(false)
      setDraft('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  /** 回车保存 / Esc 放弃 */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commitEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      // 拦下冒泡：输入框里的 Esc 只放弃改名（与通行密钥改名同款语义）
      e.stopPropagation()
      cancelEdit()
    }
  }

  return (
    <div
      className={`mt-2 flex w-full items-center gap-3 rounded-2xl bg-neutral-50/60 px-4 py-3.5 dark:bg-neutral-900/40 ${disabled ? 'opacity-50' : ''}`}
    >
      {/* 头像：可点 → 看大图 / 换图 / 删除（在 AvatarManager 里）。
          有自定义头像就显示图（签名 URL + 版本号破缓存），否则首字母 + 品牌渐变。 */}
      <button
        type="button"
        onClick={onOpenAvatar}
        aria-label="查看或修改头像"
        className="shrink-0 rounded-full active:opacity-60"
      >
        {avatarUrl && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- 签名 URL 每次不同，next/image 无法优化
          <img
            src={`${avatarUrl}&v=${avatarVersion ?? 0}`}
            alt=""
            onError={() => setImgFailed(true)}
            className="h-12 w-12 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 via-rose-400 to-violet-500 text-lg font-semibold text-white">
            {initial}
          </span>
        )}
      </button>
      <div className="min-w-0 flex-1">
        {editing ? (
          <>
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setError(null) }}
                onKeyDown={onKeyDown}
                onBlur={cancelEdit}
                disabled={busy}
                maxLength={USER_NAME_MAX}
                placeholder="你的名字"
                aria-label="新名字"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-base font-medium text-neutral-900 outline-none focus:border-neutral-400 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
              />
              {/* ★ onMouseDown 里 preventDefault 是关键：mousedown 的默认行为会把焦点从
                  输入框移走 ⇒ blur 先触发 ⇒ cancelEdit 已把编辑态关掉 ⇒ click 落不到按钮上
                  （表现就是「勾点不动」）。挡掉默认行为就不失焦。与通行密钥改名同款。 */}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void commitEdit()}
                disabled={busy || !draft.trim()}
                aria-label="保存名字"
                title="保存（回车同样有效）"
                className="shrink-0 rounded-lg bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-2.5 py-1 text-sm font-medium text-white active:opacity-70 disabled:opacity-40"
              >
                ✓
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={cancelEdit}
                disabled={busy}
                aria-label="取消修改"
                title="取消（Esc 同样有效）"
                className="shrink-0 rounded-lg border border-neutral-300 px-2.5 py-1 text-sm font-medium text-neutral-600 active:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-300 dark:active:bg-neutral-800"
              >
                ✕
              </button>
            </div>
            {error && <p role="alert" className="mt-1 text-xs text-red-500">{error}</p>}
            {/* 字数计数：沿用弹窗时代的约定（改名时要能看见长度上限）。
                放在输入框下面右对齐——就地编辑横向空间被 ✓/✕ 占了，塞不进输入框内。 */}
            <p aria-hidden className="mt-1 text-right text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400">
              {draft.trim().length}/{USER_NAME_MAX}
            </p>
          </>
        ) : (
          <>
            {/* 只有昵称本身可点（卡片整体不再可点）——用户要求「点击用户昵称修改」。
                `-mx-1 px-1` 让可点区比文字略大一圈，文字起点不变。 */}
            <button
              type="button"
              onClick={startEdit}
              disabled={busy}
              aria-disabled={disabled}
              title="点击修改名字"
              aria-label={`修改名字：${name ?? ''}`}
              className="-mx-1 block max-w-full truncate rounded-md px-1 text-left text-base font-medium text-neutral-800 active:opacity-60 dark:text-neutral-100"
            >
              {name ?? '加载中…'}
            </button>
            {subtitle && (
              <span className="mt-0.5 block truncate text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                {subtitle}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}
