'use client'

import { useRef, useEffect } from 'react'

interface WaterfallDisplayProps {
  width?: number
  height?: number
  centerFreqMhz?: number
  spanMhz?: number
}

// Color map: dark blue → cyan → yellow → red
function intensityToColor(value: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, value))
  if (t < 0.25) {
    const s = t / 0.25
    return [0, 0, Math.round(80 + 100 * s)] // dark blue → blue
  }
  if (t < 0.5) {
    const s = (t - 0.25) / 0.25
    return [0, Math.round(200 * s), Math.round(180 + 75 * s)] // blue → cyan
  }
  if (t < 0.75) {
    const s = (t - 0.5) / 0.25
    return [Math.round(255 * s), Math.round(200 + 55 * s), Math.round(255 - 200 * s)] // cyan → yellow
  }
  const s = (t - 0.75) / 0.25
  return [255, Math.round(255 - 200 * s), Math.round(55 - 55 * s)] // yellow → red
}

export default function WaterfallDisplay({
  width = 800,
  height = 300,
  centerFreqMhz = 137.9,
  spanMhz = 1.2,
}: WaterfallDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = width
    canvas.height = height

    // Generate static spectrogram data (simulated noise floor with signal)
    const fftSize = width
    const rows = height

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < fftSize; col++) {
        // Base noise floor
        let power = 0.1 + Math.random() * 0.15

        // Simulate a signal in the center
        const centerDist = Math.abs(col - fftSize / 2) / (fftSize / 2)
        if (centerDist < 0.08) {
          power += 0.6 * (1 - centerDist / 0.08) + Math.random() * 0.1
        }

        // Simulate a weaker signal offset
        const offset1Dist = Math.abs(col - fftSize * 0.3) / (fftSize / 2)
        if (offset1Dist < 0.03) {
          power += 0.3 * (1 - offset1Dist / 0.03) + Math.random() * 0.05
        }

        // Time-varying fade
        const timeFade = 0.8 + 0.2 * Math.sin(row / rows * Math.PI * 3)
        power *= timeFade

        const [r, g, b] = intensityToColor(power)
        ctx.fillStyle = `rgb(${r},${g},${b})`
        ctx.fillRect(col, row, 1, 1)
      }
    }

    // Draw axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = '10px monospace'

    // Frequency axis (bottom)
    const startFreq = centerFreqMhz - spanMhz / 2
    const endFreq = centerFreqMhz + spanMhz / 2
    for (let i = 0; i <= 4; i++) {
      const freq = startFreq + (endFreq - startFreq) * (i / 4)
      const x = (i / 4) * width
      ctx.fillText(`${freq.toFixed(1)}`, Math.max(2, x - 15), height - 4)
    }

    // Time axis labels (left side)
    ctx.fillText('0s', 2, 12)
    ctx.fillText(`${rows}s`, 2, height - 16)
  }, [width, height, centerFreqMhz, spanMhz])

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Waterfall Display</h3>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>Center: {centerFreqMhz} MHz</span>
          <span>Span: {spanMhz} MHz</span>
        </div>
      </div>
      <div className="overflow-hidden rounded">
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: `${height}px`, imageRendering: 'pixelated' }}
        />
      </div>
      <div className="flex items-center gap-3 mt-2">
        <div className="flex items-center gap-1 text-[10px] text-gray-500">
          <span>Low</span>
          <div className="flex h-2">
            {[0, 0.25, 0.5, 0.75, 1].map(v => {
              const [r, g, b] = intensityToColor(v)
              return <div key={v} className="w-4 h-2" style={{ background: `rgb(${r},${g},${b})` }} />
            })}
          </div>
          <span>High</span>
        </div>
        <span className="text-[10px] text-gray-600 ml-auto">Static preview — live streaming planned</span>
      </div>
    </div>
  )
}
