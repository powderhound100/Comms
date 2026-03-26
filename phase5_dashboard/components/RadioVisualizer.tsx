'use client'

import { useRef, useEffect, useState, useCallback } from 'react'

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

interface RadioVisualizerProps {
  psdData: number[] | null        // 256-bin dBFS array (~3 Hz updates)
  pcmBuffer?: Float32Array | null // latest PCM chunk for scope mode
  playing: boolean
}

type VisMode = 'bars' | 'spectro' | 'scope'

// ──────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────

const W = 1024
const H = 300
const NUM_BARS = 64
const MIN_DB = -80
const MAX_DB = -20
const DB_RANGE = MAX_DB - MIN_DB
const SMOOTH_TAU = 0.08  // seconds — smoothing time constant
const PEAK_GRAVITY = 2.0 // peak-hold fall speed (norm units / s²)
const HUE_SPEED = 15     // degrees per second

// Neon spectrograph palette (256 entries): deep purple → magenta → cyan → neon green → hot yellow → white
function buildSpectroLUT(): Uint8Array {
  const lut = new Uint8Array(256 * 3)
  const stops = [
    [0,    10,  5,  20],    // deep purple
    [0.15, 160, 20, 120],   // magenta
    [0.35, 0,   200, 230],  // electric cyan
    [0.55, 20,  255, 60],   // neon green
    [0.75, 255, 230, 0],    // hot yellow
    [1.0,  255, 255, 255],  // white bloom
  ]
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let si = 0
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) { si = s; break }
    }
    const [t0, r0, g0, b0] = stops[si]
    const [t1, r1, g1, b1] = stops[si + 1]
    const f = (t - t0) / (t1 - t0)
    lut[i * 3]     = Math.round(r0 + (r1 - r0) * f)
    lut[i * 3 + 1] = Math.round(g0 + (g1 - g0) * f)
    lut[i * 3 + 2] = Math.round(b0 + (b1 - b0) * f)
  }
  return lut
}

const SPECTRO_LUT = buildSpectroLUT()

// Logarithmic bin mapping: 256 FFT bins → 64 bars
function buildLogBinMap(fftSize: number, numBars: number): { start: number; end: number }[] {
  const map: { start: number; end: number }[] = []
  const logMin = Math.log(1)
  const logMax = Math.log(fftSize)
  for (let i = 0; i < numBars; i++) {
    const start = Math.floor(Math.exp(logMin + (logMax - logMin) * (i / numBars)))
    const end = Math.floor(Math.exp(logMin + (logMax - logMin) * ((i + 1) / numBars)))
    map.push({ start: Math.max(0, start), end: Math.min(fftSize - 1, Math.max(start + 1, end)) })
  }
  return map
}

// ──────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────

export default function RadioVisualizer({ psdData, pcmBuffer, playing }: RadioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visMode, setVisMode] = useState<VisMode>('bars')

  // Animation state stored in refs (no re-renders)
  const smoothBars = useRef<Float32Array>(new Float32Array(NUM_BARS))
  const peakValues = useRef<Float32Array>(new Float32Array(NUM_BARS))
  const peakVelocities = useRef<Float32Array>(new Float32Array(NUM_BARS))
  const hueOffset = useRef(0)
  const lastTime = useRef(0)
  const rafId = useRef(0)
  const latestPsd = useRef<number[] | null>(null)
  const latestPcm = useRef<Float32Array | null>(null)
  const logBinMap = useRef(buildLogBinMap(256, NUM_BARS))

  // Spectrograph image data (scrolling buffer)
  const spectroData = useRef<ImageData | null>(null)

  // Keep latest data in refs
  useEffect(() => { latestPsd.current = psdData }, [psdData])
  useEffect(() => { latestPcm.current = pcmBuffer ?? null }, [pcmBuffer])

  // ── Bars mode renderer ──
  const drawBars = useCallback((ctx: CanvasRenderingContext2D, dt: number) => {
    const psd = latestPsd.current
    const bars = smoothBars.current
    const peaks = peakValues.current
    const peakVel = peakVelocities.current
    const binMap = logBinMap.current

    // Update smoothed bar values from FFT data
    const alpha = 1 - Math.exp(-dt / SMOOTH_TAU)
    if (psd && psd.length > 0) {
      for (let k = 0; k < NUM_BARS; k++) {
        const { start, end } = binMap[k]
        let sum = 0, count = 0
        for (let b = start; b < end && b < psd.length; b++) {
          sum += psd[b]; count++
        }
        const avg = count > 0 ? sum / count : MIN_DB
        const norm = Math.max(0, Math.min(1, (avg - MIN_DB) / DB_RANGE))
        bars[k] += (norm - bars[k]) * alpha
      }
    } else {
      // Decay to zero when no data
      for (let k = 0; k < NUM_BARS; k++) {
        bars[k] *= (1 - alpha)
      }
    }

    // Update peaks with gravity
    for (let k = 0; k < NUM_BARS; k++) {
      if (bars[k] > peaks[k]) {
        peaks[k] = bars[k]
        peakVel[k] = 0
      } else {
        peakVel[k] += PEAK_GRAVITY * dt
        peaks[k] -= peakVel[k] * dt
        if (peaks[k] < 0) peaks[k] = 0
      }
    }

    // Advance hue
    hueOffset.current += HUE_SPEED * dt

    // Clear
    ctx.fillStyle = '#0a0e14'
    ctx.fillRect(0, 0, W, H)

    const midY = H / 2
    const barW = (W / NUM_BARS) * 0.75
    const gap = (W / NUM_BARS) * 0.25

    ctx.save()

    for (let k = 0; k < NUM_BARS; k++) {
      const x = (k / NUM_BARS) * W + gap / 2
      const barH = bars[k] * midY * 0.92
      const hue = (hueOffset.current + k * 4) % 360

      // Glow
      ctx.shadowColor = `hsl(${hue}, 90%, 50%)`
      ctx.shadowBlur = 12

      // Top bar (above center)
      const grad = ctx.createLinearGradient(x, midY, x, midY - barH)
      grad.addColorStop(0, `hsla(${hue}, 90%, 50%, 0.9)`)
      grad.addColorStop(1, `hsla(${(hue + 40) % 360}, 80%, 60%, 0.9)`)
      ctx.fillStyle = grad
      ctx.fillRect(x, midY - barH, barW, barH)

      // Mirror reflection (below center) — 30% opacity with fade
      ctx.shadowBlur = 0
      const reflGrad = ctx.createLinearGradient(x, midY, x, midY + barH)
      reflGrad.addColorStop(0, `hsla(${hue}, 90%, 50%, 0.3)`)
      reflGrad.addColorStop(1, `hsla(${hue}, 90%, 50%, 0.0)`)
      ctx.fillStyle = reflGrad
      ctx.fillRect(x, midY, barW, barH * 0.6)

      // Peak dot
      if (peaks[k] > 0.01) {
        const peakY = midY - peaks[k] * midY * 0.92
        ctx.shadowColor = 'rgba(180, 255, 255, 0.8)'
        ctx.shadowBlur = 6
        ctx.fillStyle = 'rgba(180, 255, 255, 0.9)'
        ctx.fillRect(x, peakY - 2, barW, 3)
        ctx.shadowBlur = 0
      }
    }

    ctx.restore()

    // Center line
    ctx.strokeStyle = 'rgba(100, 120, 140, 0.15)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, midY)
    ctx.lineTo(W, midY)
    ctx.stroke()
  }, [])

  // ── Spectrograph mode renderer ──
  const drawSpectro = useCallback((ctx: CanvasRenderingContext2D, _dt: number) => {
    // Initialize spectrograph image data on first use
    if (!spectroData.current) {
      spectroData.current = ctx.createImageData(W, H)
      // Fill with background color
      const d = spectroData.current.data
      for (let i = 0; i < d.length; i += 4) {
        d[i] = 10; d[i + 1] = 14; d[i + 2] = 20; d[i + 3] = 255
      }
    }

    const imgData = spectroData.current
    const d = imgData.data
    const rowBytes = W * 4

    // Scroll: shift everything up by one row
    d.copyWithin(0, rowBytes)

    // Write new bottom row from FFT data
    const psd = latestPsd.current
    const y = H - 1
    const rowStart = y * W * 4
    for (let x = 0; x < W; x++) {
      const bin = Math.floor((x / W) * 256)
      let norm = 0
      if (psd && bin < psd.length) {
        norm = Math.max(0, Math.min(1, (psd[bin] - MIN_DB) / DB_RANGE))
      }
      const lutIdx = Math.floor(norm * 255)
      d[rowStart + x * 4]     = SPECTRO_LUT[lutIdx * 3]
      d[rowStart + x * 4 + 1] = SPECTRO_LUT[lutIdx * 3 + 1]
      d[rowStart + x * 4 + 2] = SPECTRO_LUT[lutIdx * 3 + 2]
      d[rowStart + x * 4 + 3] = 255
    }

    ctx.putImageData(imgData, 0, 0)

    // Subtle bloom overlay
    ctx.save()
    ctx.globalAlpha = 0.08
    ctx.filter = 'blur(4px)'
    ctx.drawImage(ctx.canvas, 0, 0)
    ctx.restore()
  }, [])

  // ── Scope mode renderer ──
  const drawScope = useCallback((ctx: CanvasRenderingContext2D, _dt: number) => {
    // Afterglow: composite previous frame at reduced opacity
    ctx.save()
    ctx.globalAlpha = 0.7
    ctx.drawImage(ctx.canvas, 0, 0)
    ctx.restore()

    // Darken background slightly to maintain afterglow effect
    ctx.fillStyle = 'rgba(10, 14, 20, 0.3)'
    ctx.fillRect(0, 0, W, H)

    // Grid lines (faint)
    ctx.strokeStyle = 'rgba(80, 200, 120, 0.06)'
    ctx.lineWidth = 1
    for (let i = 1; i < 6; i++) {
      const y = (i / 6) * H
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }
    for (let i = 1; i < 10; i++) {
      const x = (i / 10) * W
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
    }

    // Center line
    ctx.strokeStyle = 'rgba(80, 200, 120, 0.12)'
    ctx.beginPath()
    ctx.moveTo(0, H / 2)
    ctx.lineTo(W, H / 2)
    ctx.stroke()

    // Get waveform data — prefer PCM, fall back to FFT
    let waveform: Float32Array | number[] | null = latestPcm.current
    if (!waveform || waveform.length === 0) {
      // Synthesize a pseudo-waveform from FFT magnitudes
      const psd = latestPsd.current
      if (psd && psd.length > 0) {
        const synth = new Float32Array(512)
        for (let i = 0; i < 512; i++) {
          let val = 0
          for (let k = 0; k < Math.min(psd.length, 32); k++) {
            const amp = Math.max(0, (psd[k] - MIN_DB) / DB_RANGE) * 0.5
            val += amp * Math.sin((2 * Math.PI * (k + 1) * i) / 512)
          }
          synth[i] = val / 8
        }
        waveform = synth
      }
    }

    if (!waveform || waveform.length === 0) return

    // Zero-crossing trigger for stable waveform display
    let triggerIdx = 0
    for (let i = 1; i < Math.min(waveform.length / 2, 1024); i++) {
      if (waveform[i - 1] <= 0 && waveform[i] > 0) {
        triggerIdx = i
        break
      }
    }

    const displayLen = Math.min(waveform.length - triggerIdx, 1024)

    // Draw phosphor trace
    ctx.save()
    ctx.shadowColor = 'hsl(160, 100%, 60%)'
    ctx.shadowBlur = 8
    ctx.strokeStyle = 'hsl(160, 100%, 60%)'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < displayLen; i++) {
      const x = (i / displayLen) * W
      const sample = waveform[triggerIdx + i]
      const y = H / 2 - sample * H * 0.4
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.restore()

    // CRT vignette
    const vigGrad = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, W * 0.7)
    vigGrad.addColorStop(0, 'rgba(0,0,0,0)')
    vigGrad.addColorStop(1, 'rgba(0,0,0,0.4)')
    ctx.fillStyle = vigGrad
    ctx.fillRect(0, 0, W, H)
  }, [])

  // ── Main animation loop ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    let visible = true
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
    }, { threshold: 0.1 })
    observer.observe(canvas)

    lastTime.current = performance.now()

    const tick = (now: number) => {
      const dt = Math.min((now - lastTime.current) / 1000, 0.1) // cap at 100ms
      lastTime.current = now

      if (visible) {
        if (visMode === 'bars') drawBars(ctx, dt)
        else if (visMode === 'spectro') drawSpectro(ctx, dt)
        else if (visMode === 'scope') drawScope(ctx, dt)
      }

      rafId.current = requestAnimationFrame(tick)
    }

    rafId.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafId.current)
      observer.disconnect()
    }
  }, [visMode, drawBars, drawSpectro, drawScope])

  // Reset spectrograph data on mode switch
  useEffect(() => {
    if (visMode !== 'spectro') {
      spectroData.current = null
    }
  }, [visMode])

  const modeButtons: { key: VisMode; label: string }[] = [
    { key: 'bars', label: 'BARS' },
    { key: 'spectro', label: 'SPECTRO' },
    { key: 'scope', label: 'SCOPE' },
  ]

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{ width: '100%', height: '300px' }}
        className="block rounded-b-xl"
      />

      {/* Mode switcher */}
      <div className="absolute top-3 right-3 flex bg-black/50 backdrop-blur-sm rounded-full overflow-hidden border border-white/10">
        {modeButtons.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setVisMode(key)}
            className={`px-3 py-1 text-[10px] uppercase tracking-wider font-mono transition-colors ${
              visMode === key
                ? 'bg-white/15 text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Status indicator */}
      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-b-xl">
          <span className="text-xs text-gray-500 font-mono">Press Listen to activate visualizer</span>
        </div>
      )}
    </div>
  )
}
