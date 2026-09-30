// 保存成功音效：Web Audio API 合成（无需音频文件）——类似任天堂游戏的清脆 coin 音
// （B5 → E6 双音快速琶音，约 200ms）。iOS 上 AudioContext 需用户手势激活——保存按钮点击即手势。
import { isSaveSoundEnabled } from './prefs'

let ctx: AudioContext | null = null

// 受偏好控制的唯一入口：所有调用点都用它，别直接调 playSaveSound()
// （偏好默认开，关闭后连 AudioContext 都不创建）。
export function playSaveSoundIfEnabled(): void {
  if (!isSaveSoundEnabled()) return
  playSaveSound()
}

export function playSaveSound(): void {
  try {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const t = ctx.currentTime
    const notes = [
      { f: 987.77, d: 0.07, delay: 0 },    // B5（短促）
      { f: 1318.51, d: 0.28, delay: 0.08 }, // E6（尾音拉长渐弱）
    ]
    for (const n of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = n.f
      gain.gain.setValueAtTime(0.0001, t + n.delay)
      gain.gain.exponentialRampToValueAtTime(0.2, t + n.delay + 0.01)
      // 尾音渐弱：衰减时间拉长，指数曲线自然形成"叮——"的余韵
      gain.gain.exponentialRampToValueAtTime(0.0001, t + n.delay + n.d)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t + n.delay)
      osc.stop(t + n.delay + n.d)
    }
  } catch { /* 音频不可用静默 */ }
}
