'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useDialogBehavior } from '@/lib/client/dialog'
import { loadUserName, setCachedAvatar } from '@/lib/client/profile'
import { useProfile } from '@/lib/client/use-user-name'

// 头像管理弹窗：看大图 → 换一张（选图 → 拖动/缩放 → 上传）→ 删除。
//
// ── 裁剪为什么自己画 canvas，不用裁剪库 ─────────────────────────────────
// 2026-11-04 第一版用 react-easy-crop，真机上是「取景框一片黑、拖不动、滑块没反应」——
// 图片根本没被渲染出来（样式确认已打进产物，问题出在库内部的媒体加载时序，无法在此环境定位）。
// 改成自绘：**预览用的 canvas 就是最终要上传的那块图**，不存在「库坐标 ↔ 导出坐标」的换算，
// 这一类 bug 从根上消失。代价是多几十行，但每一行行为都可见、可验证。
//
// ── 坐标模型（只有一个）─────────────────────────────────────────────────
// 选图后先把原图缩到最长边 ≤1024 画进离屏 canvas（source），此后一切操作都在**源图像素**里：
//   baseSize = min(源宽, 源高)     ← zoom=1 时取景正方形的边长
//   size     = baseSize / zoom    ← zoom∈[1,3]，越大取景越小 = 画面放得越大
//   center   = (cx, cy)           ← 取景框中心在源图上的位置，受边界约束
// 预览与导出都调同一个 drawCropRect：源图 (cx-size/2, cy-size/2, size, size) → 目标方形。
//
// ── 交互 ────────────────────────────────────────────────────────────────
// 单指/鼠标拖动 = 移动取景，滑块 = 缩放。用 Pointer Events（iOS 13+ 支持），
// 不用 touch 事件拼手势，避免和页面滚动打架。

/** 源图最长边：足够 256 输出，又不会让拖动时每帧重采样几千万像素 */
const SOURCE_MAX_EDGE = 1024
/** 最终输出边长（px） */
const OUTPUT_SIZE = 256
/** 取景框显示边长上限（CSS px） */
const VIEW_MAX = 288
/** 原图上限：再大也没意义，只占内存 */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024

type View = 'preview' | 'crop'
type Source = { canvas: HTMLCanvasElement; width: number; height: number }

/** 从源 canvas 按 (cx, cy, size) 裁一块，画到目标 ctx 的 (0,0,dest,dest) */
function drawCropRect(
  ctx: CanvasRenderingContext2D,
  src: Source,
  cx: number,
  cy: number,
  size: number,
  dest: number,
) {
  ctx.clearRect(0, 0, dest, dest)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src.canvas, cx - size / 2, cy - size / 2, size, size, 0, 0, dest, dest)
}

/**
 * 把选中的文件解码成可绘制的图像源。
 *
 * ★ 两条路都不用 blob URL —— 2026-11-04 真机事故：选择图片后必然报「图片读取失败」，
 *   iOS PWA 与桌面浏览器都复现。根因是**在解码之前就清空了 input.value**：
 *   Safari 会随之回收 FileList，先前拿到的 File 变成无效引用 ⇒ createObjectURL + 解码全失败。
 *   现在：① 清空挪到读完之后（见 onFileChange 的 finally）；② 解码本身也不再依赖 URL。
 */
async function decodeImage(file: File): Promise<{ el: CanvasImageSource; width: number; height: number; release: () => void }> {
  // ① 优先 createImageBitmap：直接从 File 解码，不创建任何 URL（iOS 15+ / 各桌面浏览器）
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file)
      return { el: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() }
    } catch { /* 某些格式解不了，退回下一条 */ }
  }
  // ② 回退：FileReader → dataURL → <img>（dataURL 自包含，不受 URL 生命周期影响）
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('这张图片读不出来，换一张 JPG / PNG 试试'))
    reader.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('这张图片浏览器解不了，换一张 JPG / PNG 试试'))
    el.src = dataUrl
  })
  return { el: img, width: img.naturalWidth, height: img.naturalHeight, release: () => { /* img 无需释放 */ } }
}

/** 解码 + 缩到最长边 SOURCE_MAX_EDGE，返回离屏 canvas */
async function buildSource(file: File): Promise<Source> {
  const decoded = await decodeImage(file)
  try {
    const { width: w, height: h } = decoded
    if (!w || !h) throw new Error('这张图片是空的，换一张试试')
    const scale = Math.min(1, SOURCE_MAX_EDGE / Math.max(w, h))
    const width = Math.max(1, Math.round(w * scale))
    const height = Math.max(1, Math.round(h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('浏览器不支持图片处理')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(decoded.el, 0, 0, width, height)
    return { canvas, width, height }
  } finally {
    decoded.release() // ImageBitmap 占的是原生内存，用完立刻释放
  }
}

export default function AvatarManager({ onClose, onSaved, disabled = false }: {
  onClose: () => void
  /** 上传/删除成功后回调（上层用来弹提示） */
  onSaved?: (message: string) => void
  /** 离线：可以看大图，但换/删都要联网，按钮禁用 */
  disabled?: boolean
}) {
  const { name, avatarUrl, avatarVersion } = useProfile()
  const [view, setView] = useState<View>('preview')
  const [source, setSource] = useState<Source | null>(null)
  const [zoom, setZoom] = useState(1)
  const [center, setCenter] = useState({ x: 0, y: 0 })
  const [viewSize, setViewSize] = useState(VIEW_MAX)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cardRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 拖拽会话不放进 state：每次 pointermove 都 setState 会多一轮重渲染
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null)
  useDialogBehavior(cardRef, onClose)

  // 取景框尺寸随屏幕变化（窄屏上 w-full 会小于 288）
  useEffect(() => {
    const el = boxRef.current
    if (!el || view !== 'crop') return
    const update = () => setViewSize(Math.min(VIEW_MAX, el.clientWidth || VIEW_MAX))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [view])

  /** 签名 URL 自带 query（Expires / Signature），追加版本号要用 & */
  const bigUrl = avatarUrl ? `${avatarUrl}&v=${avatarVersion ?? 0}` : null
  const initial = name ? ([...name][0] ?? '·') : '·'

  const baseSize = source ? Math.min(source.width, source.height) : 0
  const cropSize = baseSize > 0 ? baseSize / zoom : 0

  /** 把取景中心夹在合法范围内（取景框不能超出源图） */
  const clampCenter = useCallback((x: number, y: number, size: number, src: Source) => {
    const half = size / 2
    return {
      x: Math.min(Math.max(x, half), Math.max(half, src.width - half)),
      y: Math.min(Math.max(y, half), Math.max(half, src.height - half)),
    }
  }, [])

  // 重绘预览：crop / zoom / 尺寸变化都走这里
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !source || cropSize <= 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const px = Math.max(1, Math.round(viewSize * dpr))
    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px
      canvas.height = px
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawCropRect(ctx, source, center.x, center.y, cropSize, px)
  }, [source, center, cropSize, viewSize])

  function pickFile() {
    if (disabled || busy) return
    setError(null)
    fileRef.current?.click()
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    // ★ 先抓住 input 引用：React 合成事件在 await 之后 currentTarget 会失效。
    const input = e.currentTarget
    const file = input.files?.[0]
    if (!file) return
    // 类型 / 大小不对：直接报错返回。这里**不**清空 input —— 清空统一放到 finally，
    // 免得"提前清空"这条坑以后再被抄进成功路径（见 finally 的注释）。
    if (!file.type.startsWith('image/')) { setError('请选择图片文件'); return }
    if (file.size > MAX_SOURCE_BYTES) { setError('图片太大（上限 20MB）'); return }
    setBusy(true)
    setError(null)
    try {
      const built = await buildSource(file)
      const size = Math.min(built.width, built.height)
      setSource(built)
      setZoom(1)
      setCenter(clampCenter(built.width / 2, built.height / 2, size, built))
      setView('crop')
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片读取失败，请换一张试试')
    } finally {
      // ★ 清空必须放在**读完文件之后**：提前清空会让 Safari 回收 FileList，
      //   已经拿到的 File 变成无效引用，解码必然失败（真机事故，见 decodeImage 的注释）。
      //   放在 finally 同样支持「连续选同一张图」再次触发 change。
      input.value = ''
      setBusy(false)
    }
  }

  function backToPreview() {
    if (busy) return
    setSource(null)
    setError(null)
    setView('preview')
  }

  /** 拖动：显示像素 → 源图像素（比例 = cropSize / viewSize） */
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (busy || !source) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId || !source) return
    const k = cropSize / viewSize
    const dx = (e.clientX - drag.lastX) * k
    const dy = (e.clientY - drag.lastY) * k
    drag.lastX = e.clientX
    drag.lastY = e.clientY
    // 手指往右拖 ⇒ 取景框在源图上往左移（画面跟着手指走）
    setCenter((prev) => clampCenter(prev.x - dx, prev.y - dy, cropSize, source))
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null
  }

  function onZoomChange(next: number) {
    if (!source) return
    setZoom(next)
    const size = baseSize / next
    setCenter((prev) => clampCenter(prev.x, prev.y, size, source))
  }

  async function upload() {
    if (!source || busy) return
    setBusy(true)
    setError(null)
    try {
      // 直接从源图裁 256×256 —— 预览画的就是这块，无坐标换算
      const out = document.createElement('canvas')
      out.width = OUTPUT_SIZE
      out.height = OUTPUT_SIZE
      const ctx = out.getContext('2d')
      if (!ctx) throw new Error('浏览器不支持图片处理')
      drawCropRect(ctx, source, center.x, center.y, cropSize, OUTPUT_SIZE)

      const toBlob = (type: string) => new Promise<Blob | null>((resolve) => out.toBlob(resolve, type, 0.9))
      // WebP 优先（约为 JPEG 的 60% 体积）；个别环境不支持编码时退回 JPEG
      const blob = (await toBlob('image/webp')) ?? (await toBlob('image/jpeg'))
      if (!blob) throw new Error('图片编码失败')

      const form = new FormData()
      form.append('file', blob, 'avatar.webp')
      const res = await fetch('/api/avatar', { method: 'POST', body: form })
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(data?.error === 'too_large' ? '图片太大，请重新选择' : '上传失败，请重试')
      }
      const data = await res.json() as { avatarUrl: string; avatarVersion: number }
      // 先乐观写缓存（立刻换图），再强制与服务端对一次 ——
      // ★ force 不能省：loadUserName 缓存命中会直接返回，不 force 的话这次「校准」等于没做。
      setCachedAvatar({ url: data.avatarUrl, version: data.avatarVersion })
      void loadUserName({ force: true }).catch(() => { /* 校准失败无妨，本地缓存已是新值 */ })
      onSaved?.('头像已更新')
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
      void loadUserName({ force: true }).catch(() => {})
      onSaved?.('头像已删除')
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
                  // eslint-disable-next-line @next/next/no-img-element -- 签名 URL 每次不同，无需 next/image
                  <img src={bigUrl} alt="当前头像" className="h-40 w-40 rounded-full object-cover" />
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
            <div className="flex border-t border-neutral-200 dark:border-neutral-700">
              <button
                onClick={pickFile}
                disabled={disabled || busy}
                className="w-1/2 border-r border-neutral-200 py-3.5 text-base font-semibold text-blue-500 active:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:active:bg-neutral-700"
              >
                {bigUrl ? '换一张' : '选择图片'}
              </button>
              <button
                onClick={bigUrl ? () => void remove() : onClose}
                disabled={disabled || busy}
                className={`w-1/2 py-3.5 text-base active:bg-neutral-100 disabled:opacity-40 dark:active:bg-neutral-700 ${
                  bigUrl ? 'text-red-500' : 'text-neutral-700 dark:text-neutral-300'
                }`}
              >
                {busy ? '处理中…' : bigUrl ? '删除' : '完成'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-5 pb-3 pt-5">
              <p className="text-center text-base font-semibold text-neutral-900 dark:text-neutral-100">调整头像</p>
              <p className="mt-1 text-center text-xs text-neutral-500 dark:text-neutral-400">
                拖动图片调整位置，用滑块缩放
              </p>
            </div>
            {/* 取景区：方形 canvas，圆形提示用 box-shadow 挖洞（pointer-events-none 不挡拖动） */}
            <div className="px-5">
              <div
                ref={boxRef}
                className="relative mx-auto w-full overflow-hidden rounded-2xl bg-neutral-900"
                style={{ maxWidth: VIEW_MAX, aspectRatio: '1 / 1', touchAction: 'none' }}
              >
                <canvas
                  ref={canvasRef}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  aria-label="头像预览，拖动可调整位置"
                  className="h-full w-full cursor-move touch-none select-none"
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
                  style={{
                    width: '92%',
                    height: '92%',
                    left: '4%',
                    top: '4%',
                    outline: '2px solid rgba(255,255,255,0.55)',
                    outlineOffset: '-2px',
                  }}
                />
              </div>
            </div>
            <div className="px-5 py-3">
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(e) => onZoomChange(Number(e.target.value))}
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
                disabled={busy || !source}
                className="w-1/2 py-3.5 text-base font-semibold text-blue-500 active:bg-neutral-100 disabled:opacity-40 dark:active:bg-neutral-700"
              >
                {busy ? '上传中…' : '使用这张'}
              </button>
            </div>
          </>
        )}
        {/* 文件选择：accept 让 iOS 直接给「照片图库 / 拍照」选择 */}
        <input ref={fileRef} type="file" accept="image/*" onChange={onFileChange} className="hidden" />
      </div>
    </div>
  )
}
