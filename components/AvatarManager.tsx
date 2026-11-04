'use client'

import { useEffect, useRef, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'
import { useDialogBehavior } from '@/lib/client/dialog'
import { setCachedAvatar } from '@/lib/client/profile'
import { useProfile } from '@/lib/client/use-user-name'

// 头像管理弹窗：看大图 → 换一张（选图 → 裁剪缩放 → 上传）→ 或删除。
//
// ── 为什么合并成一个组件 ────────────────────────────────────────────────
// 「看大图」和「换头像」是同一个入口的两步（点开头像，先看，再决定换不换），
// 拆成两个弹窗会多一次开关、还要在两处同步头像状态。这里用 view 切换。
//
// ── 裁剪 ───────────────────────────────────────────────────────────────
// react-easy-crop 负责取景（拖动 + 双指/滚轮缩放 + 圆形遮罩），导出靠 canvas：
// 按它给的 croppedAreaPixels 从原图裁一块，画到 256×256 画布上，再编码成 WebP。
// 256 是**刻意小**的：头像最大只会显示到 96px（3x 屏 = 288），256 够清晰，
// 而一张约 20KB —— 上传、存储、下行全都便宜到可忽略。
//
// ── 上传为什么走自家 API ────────────────────────────────────────────────
// 图已经压到 20KB，过一遍 ECS 是毫秒级；换来「零 CORS、AK 只留在服务器」。
// 详见 app/api/avatar/route.ts 的注释。
//
// ★ 弹窗行为（Esc / Tab 循环 / 焦点归还）由 useDialogBehavior 统一管，Esc = 关闭。

const OUTPUT_SIZE = 256
/** 原图上限：再大也没意义（最终只输出 256×256），只是白白占内存 */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024

type View = 'preview' | 'crop'

/** 把 objectURL 读成 HTMLImageElement（canvas 绘制需要已解码的图片） */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片读取失败'))
    img.src = src
  })
}

/** 按裁剪区域导出 256×256 的图片 */
async function cropToBlob(src: string, area: Area): Promise<Blob> {
  const img = await loadImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_SIZE
  canvas.height = OUTPUT_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持图片处理')
  // 头像统一圆形显示，把裁剪区外的内容也带上（圆形遮罩由 CSS 负责），
  // 这里不画透明圆——万一以后改用方形头像，图还是完整的。
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)

  const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9))
  // WebP 优先（体积约为 JPEG 的 60%）；个别老环境编码不支持时退回 JPEG
  const webp = await toBlob('image/webp')
  if (webp) return webp
  const jpeg = await toBlob('image/jpeg')
  if (jpeg) return jpeg
  throw new Error('图片编码失败')
}

export default function AvatarManager({ onClose, disabled = false }: {
  onClose: () => void
  /** 离线：可以看大图，但换/删都要联网，按钮禁用 */
  disabled?: boolean
}) {
  const { name, avatarUrl, avatarVersion } = useProfile()
  const [view, setView] = useState<View>('preview')
  const [source, setSource] = useState<string | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState<Area | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cardRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useDialogBehavior(cardRef, onClose)

  // objectURL 用完必须撤销，否则整张原图会一直留在内存里
  useEffect(() => {
    return () => { if (source) URL.revokeObjectURL(source) }
  }, [source])

  /** 签名的 URL 自带 query（Expires / Signature），追加版本号要用 & 而不是 ? */
  const bigUrl = avatarUrl ? `${avatarUrl}&v=${avatarVersion ?? 0}` : null
  const initial = name ? ([...name][0] ?? '·') : '·'

  function pickFile() {
    if (disabled || busy) return
    setError(null)
    fileRef.current?.click()
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许连续选同一张
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('请选择图片文件'); return }
    if (file.size > MAX_SOURCE_BYTES) { setError('图片太大（上限 20MB）'); return }
    if (source) URL.revokeObjectURL(source)
    setSource(URL.createObjectURL(file))
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setArea(null)
    setView('crop')
  }

  function backToPreview() {
    if (busy) return
    if (source) URL.revokeObjectURL(source)
    setSource(null)
    setError(null)
    setView('preview')
  }

  async function upload() {
    if (!source || !area || busy) return
    setBusy(true)
    setError(null)
    try {
      const blob = await cropToBlob(source, area)
      const form = new FormData()
      form.append('file', blob, 'avatar.webp')
      const res = await fetch('/api/avatar', { method: 'POST', body: form })
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(data?.error === 'too_large' ? '图片太大，请重新选择' : '上传失败，请重试')
      }
      const data = await res.json() as { avatarUrl: string; avatarVersion: number }
      // 直接写回缓存：设置页卡片立刻换成新图，不用再打一次 /api/profile
      setCachedAvatar({ url: data.avatarUrl, version: data.avatarVersion })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败，请重试')
      setBusy(false)
    }
  }

  async function remove() {
    if (disabled || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/avatar', { method: 'DELETE' })
      if (!res.ok) throw new Error('删除失败，请重试')
      setCachedAvatar(null)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败，请重试')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={onClose}>
      <div
        ref={cardRef}
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={view === 'crop' ? '裁剪头像' : '头像'}
      >
        {view === 'preview' ? (
          <>
            <div className="px-5 pb-4 pt-5">
              <p className="text-center text-base font-semibold text-neutral-900 dark:text-neutral-100">头像</p>
              <div className="mt-4 flex justify-center">
                {bigUrl ? (
                  /* 大图：object-cover + 圆形，与卡片上的小头像同一张图 */
                  // eslint-disable-next-line @next/next/no-img-element -- 签名 URL 是动态的，无需 next/image 优化
                  <img
                    src={bigUrl}
                    alt="当前头像"
                    className="h-40 w-40 rounded-full object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="flex h-40 w-40 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 via-rose-400 to-violet-500 text-5xl font-semibold text-white"
                  >
                    {initial}
                  </span>
                )}
              </div>
              {!bigUrl && (
                <p className="mt-3 text-center text-xs text-neutral-500 dark:text-neutral-400">
                  还没有自定义头像，现在用的是名字首字母
                </p>
              )}
              {error && <p role="alert" className="mt-3 text-center text-xs text-red-500">{error}</p>}
            </div>
            {bigUrl ? (
              <div className="flex border-t border-neutral-200 dark:border-neutral-700">
                <button
                  onClick={pickFile}
                  disabled={disabled || busy}
                  className="w-1/2 border-r border-neutral-200 py-3.5 text-base font-semibold text-blue-500 active:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:active:bg-neutral-700"
                >
                  换一张
                </button>
                <button
                  onClick={() => void remove()}
                  disabled={disabled || busy}
                  className="w-1/2 py-3.5 text-base text-red-500 active:bg-neutral-100 disabled:opacity-40 dark:active:bg-neutral-700"
                >
                  {busy ? '处理中…' : '删除'}
                </button>
              </div>
            ) : (
              <div className="flex border-t border-neutral-200 dark:border-neutral-700">
                <button
                  onClick={pickFile}
                  disabled={disabled || busy}
                  className="w-full py-3.5 text-base font-semibold text-blue-500 active:bg-neutral-100 disabled:opacity-40 dark:active:bg-neutral-700"
                >
                  选择图片
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="px-5 pb-3 pt-5">
              <p className="text-center text-base font-semibold text-neutral-900 dark:text-neutral-100">裁剪头像</p>
              <p className="mt-1 text-center text-xs text-neutral-500 dark:text-neutral-400">
                拖动调整位置，双指或滑块缩放
              </p>
            </div>
            {/* 取景区：固定高度，圆形遮罩；cropper 自己接管触摸手势 */}
            <div className="relative h-72 w-full bg-neutral-900">
              {source && (
                <Cropper
                  image={source}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  cropShape="round"
                  showGrid={false}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={(_, pixels) => setArea(pixels)}
                />
              )}
            </div>
            <div className="px-5 py-3">
              {/* 滑块缩放：双指手势不是所有人都知道，给一个明确的兜底 */}
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                aria-label="缩放"
                className="w-full accent-violet-500"
              />
              {error && <p role="alert" className="mt-2 text-center text-xs text-red-500">{error}</p>}
            </div>
            <div className="flex border-t border-neutral-200 dark:border-neutral-700">
              <button
                onClick={backToPreview}
                disabled={busy}
                className="w-1/2 border-r border-neutral-200 py-3.5 text-base text-neutral-700 active:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:active:bg-neutral-700"
              >
                取消
              </button>
              <button
                onClick={() => void upload()}
                disabled={busy || !area}
                className="w-1/2 py-3.5 text-base font-semibold text-blue-500 active:bg-neutral-100 disabled:opacity-40 dark:active:bg-neutral-700"
              >
                {busy ? '上传中…' : '使用这张'}
              </button>
            </div>
          </>
        )}
        {/* 文件选择：不显示，点按钮触发。accept 让 iOS 直接给「照片图库 / 拍照」选择 */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={onFileChange}
          className="hidden"
        />
      </div>
    </div>
  )
}
