'use client'

import { useEffect, useRef, useState, memo } from 'react'

// Neon waterfall color LUT (deep blue → cyan → green → yellow → white)
const WATERFALL_LUT: [number, number, number][] = (() => {
  const lut: [number, number, number][] = new Array(256)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    if (t < 0.25) {
      const s = t / 0.25
      lut[i] = [0, 0, Math.round(60 + 140 * s)]
    } else if (t < 0.5) {
      const s = (t - 0.25) / 0.25
      lut[i] = [0, Math.round(200 * s), Math.round(200 + 55 * s)]
    } else if (t < 0.75) {
      const s = (t - 0.5) / 0.25
      lut[i] = [Math.round(255 * s), Math.round(200 + 55 * s), Math.round(255 - 200 * s)]
    } else {
      const s = (t - 0.75) / 0.25
      lut[i] = [255, Math.round(255 - 100 * s), Math.round(55 + 200 * s)]
    }
  }
  return lut
})()

interface SpectrumPanelProps {
  psdData: number[] | null
  centerFreq: number
  bandwidth: number
  label: string
  color: 'cyan' | 'orange'
  height: number
  connected: boolean
  emptyMessage: string
}

function SpectrumPanel({
  psdData, centerFreq, bandwidth, label, color, height, connected, emptyMessage,
}: SpectrumPanelProps) {
  const [mode, setMode] = useState<'fft' | 'waterfall'>('fft')
  const fftCanvasRef = useRef<HTMLCanvasElement>(null)
  const waterfallCanvasRef = useRef<HTMLCanvasElement>(null)
  const waterfallInitRef = useRef(false)

  const accentColor = color === 'cyan'
    ? { line: 'rgba(56, 189, 248, 0.8)', fill0: 'rgba(56, 189, 248, 0.5)', fill1: 'rgba(52, 211, 153, 0.3)', grid: 'rgba(56, 189, 248, 0.06)' }
    : { line: 'rgba(251, 146, 60, 0.8)', fill0: 'rgba(251, 146, 60, 0.5)', fill1: 'rgba(251, 191, 36, 0.3)', grid: 'rgba(251, 146, 60, 0.06)' }

  // FFT renderer
  useEffect(() => {
    if (mode !== 'fft') return
    const canvas = fftCanvasRef.current
    if (!canvas || !psdData || psdData.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    const minDb = -80
    const maxDb = -20

    ctx.fillStyle = '#0a0e14'
    ctx.fillRect(0, 0, w, h)

    // Grid
    ctx.strokeStyle = accentColor.grid
    ctx.lineWidth = 1
    for (let i = 1; i < 6; i++) {
      const y = (i / 6) * h
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
    }
    for (let i = 1; i < 8; i++) {
      const x = (i / 8) * w
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
    }

    // Fill gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, h)
    gradient.addColorStop(0, accentColor.fill0)
    gradient.addColorStop(0.5, accentColor.fill1)
    gradient.addColorStop(1, 'rgba(0,0,0,0)')

    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let i = 0; i < psdData.length; i++) {
      const x = (i / psdData.length) * w
      const norm = Math.max(0, Math.min(1, (psdData[i] - minDb) / (maxDb - minDb)))
      const y = h - norm * h * 0.9
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fillStyle = gradient
    ctx.fill()

    // Spectrum line
    ctx.beginPath()
    for (let i = 0; i < psdData.length; i++) {
      const x = (i / psdData.length) * w
      const norm = Math.max(0, Math.min(1, (psdData[i] - minDb) / (maxDb - minDb)))
      const y = h - norm * h * 0.9
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = accentColor.line
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Center marker
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.4)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke()
    ctx.setLineDash([])

    // Freq labels
    ctx.fillStyle = 'rgba(156, 163, 175, 0.5)'
    ctx.font = '10px monospace'
    ctx.textAlign = 'center'
    const startMhz = (centerFreq - bandwidth / 2) / 1e6
    const stopMhz = (centerFreq + bandwidth / 2) / 1e6
    for (let i = 0; i <= 4; i++) {
      const f = startMhz + (stopMhz - startMhz) * (i / 4)
      ctx.fillText(f.toFixed(2), (i / 4) * w, h - 4)
    }

    // dB scale
    ctx.textAlign = 'left'
    for (let db = minDb; db <= maxDb; db += 20) {
      const norm = (db - minDb) / (maxDb - minDb)
      const y = h - norm * h * 0.9
      ctx.fillText(`${db}`, 4, y - 2)
    }
  }, [psdData, mode, accentColor, centerFreq, bandwidth])

  // Waterfall renderer
  useEffect(() => {
    if (mode !== 'waterfall') return
    const canvas = waterfallCanvasRef.current
    if (!canvas || !psdData || psdData.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    const minDb = -80
    const maxDb = -20

    // Initialize with black on first render
    if (!waterfallInitRef.current) {
      ctx.fillStyle = '#0a0e14'
      ctx.fillRect(0, 0, w, h)
      waterfallInitRef.current = true
    }

    // Shift existing content down by 1 pixel
    const imageData = ctx.getImageData(0, 0, w, h - 1)
    ctx.putImageData(imageData, 0, 1)

    // Draw new spectrum row at top
    const binWidth = w / psdData.length
    for (let i = 0; i < psdData.length; i++) {
      const norm = Math.max(0, Math.min(1, (psdData[i] - minDb) / (maxDb - minDb)))
      const idx = Math.round(norm * 255)
      const [r, g, b] = WATERFALL_LUT[idx]
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.fillRect(i * binWidth, 0, Math.ceil(binWidth), 1)
    }

    // Frequency labels overlay (bottom)
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(0, h - 16, w, 16)
    ctx.fillStyle = 'rgba(156, 163, 175, 0.6)'
    ctx.font = '10px monospace'
    ctx.textAlign = 'center'
    const startMhz = (centerFreq - bandwidth / 2) / 1e6
    const stopMhz = (centerFreq + bandwidth / 2) / 1e6
    for (let i = 0; i <= 4; i++) {
      const f = startMhz + (stopMhz - startMhz) * (i / 4)
      ctx.fillText(f.toFixed(2), (i / 4) * w, h - 4)
    }
  }, [psdData, mode, centerFreq, bandwidth])

  // Reset waterfall when switching to it
  useEffect(() => {
    if (mode === 'waterfall') {
      waterfallInitRef.current = false
    }
  }, [mode])

  return (
    <div className="relative">
      {/* Mode toggle */}
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        <button
          onClick={() => setMode('fft')}
          className={`px-2 py-1 text-[10px] uppercase tracking-wider font-mono rounded border transition-colors ${
            mode === 'fft'
              ? color === 'cyan'
                ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-400'
                : 'bg-orange-500/20 border-orange-500/40 text-orange-400'
              : 'bg-black/40 border-gray-700 text-gray-500 hover:text-gray-300'
          }`}
        >
          FFT
        </button>
        <button
          onClick={() => setMode('waterfall')}
          className={`px-2 py-1 text-[10px] uppercase tracking-wider font-mono rounded border transition-colors ${
            mode === 'waterfall'
              ? color === 'cyan'
                ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-400'
                : 'bg-orange-500/20 border-orange-500/40 text-orange-400'
              : 'bg-black/40 border-gray-700 text-gray-500 hover:text-gray-300'
          }`}
        >
          WFALL
        </button>
      </div>

      {/* FFT canvas */}
      <canvas
        ref={fftCanvasRef}
        width={1024}
        height={height}
        className="w-full block"
        style={{ imageRendering: 'pixelated', display: mode === 'fft' ? 'block' : 'none' }}
      />

      {/* Waterfall canvas */}
      <canvas
        ref={waterfallCanvasRef}
        width={1024}
        height={height}
        className="w-full block"
        style={{ imageRendering: 'pixelated', display: mode === 'waterfall' ? 'block' : 'none' }}
      />

      {/* Empty state */}
      {!psdData && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs text-gray-600 font-mono">
            {connected ? `Waiting for ${label} data...` : emptyMessage}
          </span>
        </div>
      )}
    </div>
  )
}

export default memo(SpectrumPanel)
