'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

// ──────────────────────────────────────────────────────────────
// Preset stations — Seattle area
// ──────────────────────────────────────────────────────────────

interface Preset {
  label: string
  freq: number // Hz
  mode: 'wfm' | 'nfm' | 'am'
  sub?: string
}

interface PresetGroup {
  name: string
  color: string
  presets: Preset[]
}

const PRESET_GROUPS: PresetGroup[] = [
  {
    name: 'FM Radio',
    color: 'emerald',
    presets: [
      { label: 'KUOW', freq: 94.9e6, mode: 'wfm', sub: 'NPR Seattle' },
      { label: 'KNKX', freq: 88.5e6, mode: 'wfm', sub: 'Jazz / NPR' },
      { label: 'KEXP', freq: 90.3e6, mode: 'wfm', sub: 'Indie / Alt' },
      { label: 'KISW', freq: 99.9e6, mode: 'wfm', sub: 'Rock' },
      { label: 'KUBE', freq: 93.3e6, mode: 'wfm', sub: 'Hip Hop' },
      { label: 'KING', freq: 98.1e6, mode: 'wfm', sub: 'Classical' },
      { label: 'KIRO', freq: 97.3e6, mode: 'wfm', sub: 'News / Talk' },
      { label: 'KMPS', freq: 94.1e6, mode: 'wfm', sub: 'Country' },
    ],
  },
  {
    name: 'Aviation',
    color: 'sky',
    presets: [
      { label: 'SEA Tower', freq: 119.9e6, mode: 'am', sub: 'Seattle-Tacoma' },
      { label: 'SEA Approach', freq: 120.4e6, mode: 'am', sub: 'Arrival' },
      { label: 'SEA Ground', freq: 121.7e6, mode: 'am', sub: 'Taxiway' },
      { label: 'Guard', freq: 121.5e6, mode: 'am', sub: 'Emergency' },
      { label: 'Boeing Fld', freq: 120.6e6, mode: 'am', sub: 'King Co Intl' },
      { label: 'ATIS', freq: 118.0e6, mode: 'am', sub: 'Weather info' },
    ],
  },
  {
    name: 'Weather',
    color: 'amber',
    presets: [
      { label: 'NWR-1', freq: 162.55e6, mode: 'nfm', sub: 'NOAA Seattle' },
      { label: 'NWR-2', freq: 162.4e6, mode: 'nfm', sub: 'NOAA alt' },
      { label: 'NWR-3', freq: 162.475e6, mode: 'nfm', sub: 'NOAA alt' },
      { label: 'NWR-4', freq: 162.425e6, mode: 'nfm', sub: 'NOAA alt' },
    ],
  },
  {
    name: 'Emergency',
    color: 'red',
    presets: [
      { label: 'SPD Dispatch', freq: 460.125e6, mode: 'nfm', sub: 'Seattle PD' },
      { label: 'SFD Dispatch', freq: 460.575e6, mode: 'nfm', sub: 'Seattle Fire' },
      { label: 'King Co SO', freq: 460.475e6, mode: 'nfm', sub: 'Sheriff' },
      { label: 'Medic One', freq: 462.975e6, mode: 'nfm', sub: 'EMS' },
      { label: 'WA Patrol', freq: 155.505e6, mode: 'nfm', sub: 'State Patrol' },
    ],
  },
  {
    name: 'Marine',
    color: 'blue',
    presets: [
      { label: 'Ch 16', freq: 156.8e6, mode: 'nfm', sub: 'Distress / Call' },
      { label: 'Ch 09', freq: 156.45e6, mode: 'nfm', sub: 'Boater calling' },
      { label: 'USCG Puget', freq: 157.1e6, mode: 'nfm', sub: 'Coast Guard' },
    ],
  },
  {
    name: 'Amateur',
    color: 'violet',
    presets: [
      { label: '2m Call', freq: 146.52e6, mode: 'nfm', sub: 'National simplex' },
      { label: 'W7AW', freq: 146.82e6, mode: 'nfm', sub: 'Seattle repeater' },
      { label: 'APRS', freq: 144.39e6, mode: 'nfm', sub: 'Packet' },
    ],
  },
]

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function formatFreq(hz: number): string {
  const mhz = hz / 1e6
  if (mhz >= 100) return mhz.toFixed(3)
  return mhz.toFixed(4)
}

function modeLabel(m: string) {
  return m === 'wfm' ? 'WFM' : m === 'nfm' ? 'NFM' : 'AM'
}

const colorMap: Record<string, { bg: string; text: string; border: string; ring: string; dot: string }> = {
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30', ring: 'ring-emerald-500/40', dot: 'bg-emerald-400' },
  sky:     { bg: 'bg-sky-500/10', text: 'text-sky-400', border: 'border-sky-500/30', ring: 'ring-sky-500/40', dot: 'bg-sky-400' },
  amber:   { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30', ring: 'ring-amber-500/40', dot: 'bg-amber-400' },
  red:     { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30', ring: 'ring-red-500/40', dot: 'bg-red-400' },
  blue:    { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30', ring: 'ring-blue-500/40', dot: 'bg-blue-400' },
  violet:  { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/30', ring: 'ring-violet-500/40', dot: 'bg-violet-400' },
}

// ──────────────────────────────────────────────────────────────
// Spectrum analyser (canvas)
// ──────────────────────────────────────────────────────────────

function useSpectrumCanvas(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  psdData: number[] | null,
  centerFreq: number,
  bandwidth: number,
) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !psdData || psdData.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    const minDb = -80
    const maxDb = -20

    // Background
    ctx.fillStyle = '#0a0e14'
    ctx.fillRect(0, 0, w, h)

    // Grid lines
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.06)'
    ctx.lineWidth = 1
    for (let i = 1; i < 6; i++) {
      const y = (i / 6) * h
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
    }
    for (let i = 1; i < 8; i++) {
      const x = (i / 8) * w
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
    }

    // Spectrum fill (gradient)
    const gradient = ctx.createLinearGradient(0, 0, 0, h)
    gradient.addColorStop(0, 'rgba(56, 189, 248, 0.5)')
    gradient.addColorStop(0.5, 'rgba(52, 211, 153, 0.3)')
    gradient.addColorStop(1, 'rgba(52, 211, 153, 0)')

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
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Center marker
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.4)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke()
    ctx.setLineDash([])

    // Frequency labels
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
  }, [canvasRef, psdData, centerFreq, bandwidth])
}

// ──────────────────────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────────────────────

export default function RadioPage() {
  const [freq, setFreq] = useState(94.9e6)
  const [mode, setMode] = useState<'wfm' | 'nfm' | 'am'>('wfm')
  const [volume, setVolume] = useState(0.7)
  const [playing, setPlaying] = useState(false)
  const [connected, setConnected] = useState(false)
  const [freqInput, setFreqInput] = useState('94.900')
  const [activePreset, setActivePreset] = useState<string | null>('KUOW')
  const [psdData, setPsdData] = useState<number[] | null>(null)
  const [signalStrength, setSignalStrength] = useState(-70)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const esRef = useRef<EventSource | null>(null)

  useSpectrumCanvas(canvasRef, psdData, freq, 2.4e6)

  // Tune to a frequency
  const tune = useCallback(async (newFreq: number, newMode: 'wfm' | 'nfm' | 'am', presetName?: string) => {
    setFreq(newFreq)
    setMode(newMode)
    setFreqInput((newFreq / 1e6).toFixed(3))
    setActivePreset(presetName ?? null)

    try {
      await fetch('/api/radio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ freq_hz: newFreq, mode: newMode }),
      })
    } catch {
      // Backend may not be running yet
    }
  }, [])

  // Connect to audio stream
  const togglePlay = useCallback(() => {
    if (playing) {
      // Stop
      esRef.current?.close()
      esRef.current = null
      audioCtxRef.current?.close()
      audioCtxRef.current = null
      gainNodeRef.current = null
      setPlaying(false)
      setConnected(false)
      return
    }

    // Start audio context
    const actx = new AudioContext({ sampleRate: 48000 })
    const gain = actx.createGain()
    gain.gain.value = volume
    gain.connect(actx.destination)
    audioCtxRef.current = actx
    gainNodeRef.current = gain
    setPlaying(true)

    // Connect to SSE stream
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    const streamUrl = isLocal
      ? `ws://localhost:8770?freq=${freq}&mode=${mode}`
      : `/api/radio/stream?freq=${freq}&mode=${mode}`

    if (isLocal) {
      // Direct WebSocket for low-latency local audio
      try {
        const ws = new WebSocket(streamUrl)
        ws.onopen = () => setConnected(true)
        ws.onclose = () => setConnected(false)
        ws.onerror = () => {
          setConnected(false)
          // Fall back to SSE
          connectSSE()
        }
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            handleAudioMessage(data)
          } catch { /* skip */ }
        }
      } catch {
        connectSSE()
      }
    } else {
      connectSSE()
    }

    function connectSSE() {
      const es = new EventSource(`/api/radio/stream?freq=${freq}&mode=${mode}`)
      esRef.current = es
      es.onopen = () => setConnected(true)
      es.onerror = () => setConnected(false)
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          handleAudioMessage(data)
        } catch { /* skip */ }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function handleAudioMessage(data: any) {
      if (data.type === 'audio' && data.samples && actx.state === 'running') {
        // Decode base64 PCM float32 samples
        const raw = atob(data.samples)
        const bytes = new Uint8Array(raw.length)
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
        const floats = new Float32Array(bytes.buffer)

        const buffer = actx.createBuffer(1, floats.length, data.sample_rate || 48000)
        buffer.getChannelData(0).set(floats)
        const source = actx.createBufferSource()
        source.buffer = buffer
        source.connect(gain)
        source.start()
      }

      if (data.type === 'spectrum') {
        setPsdData(data.psd_dbfs)
        // Estimate signal strength from peak
        if (data.psd_dbfs?.length) {
          const peak = Math.max(...data.psd_dbfs)
          setSignalStrength(peak)
        }
      }
    }
  }, [playing, freq, mode, volume])

  // Update volume
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume
    }
  }, [volume])

  // Handle manual frequency input
  const handleFreqSubmit = () => {
    const mhz = parseFloat(freqInput)
    if (!isNaN(mhz) && mhz >= 24 && mhz <= 1766) {
      tune(mhz * 1e6, mode)
    }
  }

  // Signal strength meter
  const sigPct = Math.max(0, Math.min(100, ((signalStrength + 90) / 60) * 100))
  const sigColor = sigPct > 60 ? 'bg-emerald-400' : sigPct > 30 ? 'bg-amber-400' : 'bg-red-400'

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Radio</h1>
        <p className="text-gray-400">
          Live SDR receiver — tune to any frequency and listen
        </p>
      </div>

      {/* ── Main Tuner Panel ── */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 mb-8 overflow-hidden">
        {/* Frequency display */}
        <div className="bg-[#0a0e14] px-6 py-5 border-b border-gray-800/50">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-gray-600 mb-1">Tuned Frequency</div>
              <div className="font-mono text-4xl font-light tracking-tight text-sky-400">
                {formatFreq(freq)}
                <span className="text-lg text-gray-600 ml-1">MHz</span>
              </div>
              {activePreset && (
                <div className="text-sm text-gray-500 mt-1">{activePreset}</div>
              )}
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.2em] text-gray-600 mb-1">Mode</div>
              <div className="text-xl font-mono text-fuchsia-400">{modeLabel(mode)}</div>
              <div className="flex items-center gap-2 mt-2">
                <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'}`} />
                <span className="text-xs text-gray-500">{connected ? 'Streaming' : 'Idle'}</span>
              </div>
            </div>
          </div>

          {/* Signal strength meter */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-[10px] text-gray-600 mb-1">
              <span>S-METER</span>
              <span>{signalStrength.toFixed(0)} dBFS</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${sigColor}`}
                style={{ width: `${sigPct}%` }}
              />
            </div>
            <div className="flex justify-between text-[9px] text-gray-700 mt-0.5 font-mono">
              <span>S1</span><span>S3</span><span>S5</span><span>S7</span><span>S9</span><span>+20</span><span>+40</span>
            </div>
          </div>
        </div>

        {/* Controls row */}
        <div className="px-6 py-4 flex flex-wrap gap-4 items-end border-b border-gray-800/50">
          {/* Frequency input */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-600 mb-1">Frequency (MHz)</label>
            <div className="flex">
              <input
                type="text"
                value={freqInput}
                onChange={(e) => setFreqInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleFreqSubmit()}
                className="bg-gray-800 border border-gray-700 rounded-l px-3 py-2 text-sm font-mono w-32 focus:outline-none focus:border-sky-500"
              />
              <button
                onClick={handleFreqSubmit}
                className="bg-gray-700 hover:bg-gray-600 border border-l-0 border-gray-700 rounded-r px-3 py-2 text-sm transition-colors"
              >
                Tune
              </button>
            </div>
          </div>

          {/* Mode */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-600 mb-1">Modulation</label>
            <div className="flex">
              {(['wfm', 'nfm', 'am'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => { setMode(m); tune(freq, m, activePreset ?? undefined) }}
                  className={`px-3 py-2 text-xs font-mono border transition-colors ${
                    mode === m
                      ? 'bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-400'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
                  } ${m === 'wfm' ? 'rounded-l' : m === 'am' ? 'rounded-r' : ''} ${m !== 'wfm' ? 'border-l-0' : ''}`}
                >
                  {modeLabel(m)}
                </button>
              ))}
            </div>
          </div>

          {/* Volume */}
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[10px] uppercase tracking-wider text-gray-600 mb-1">
              Volume {Math.round(volume * 100)}%
            </label>
            <input
              type="range"
              min="0" max="1" step="0.01"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-800 rounded-full appearance-none cursor-pointer accent-emerald-500"
            />
          </div>

          {/* Play/Stop */}
          <button
            onClick={togglePlay}
            className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${
              playing
                ? 'bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30'
                : 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30'
            }`}
          >
            {playing ? (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                Stop
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
                Listen
              </span>
            )}
          </button>
        </div>

        {/* Spectrum display */}
        <div className="relative">
          <canvas
            ref={canvasRef}
            width={1024}
            height={200}
            style={{ width: '100%', height: '200px' }}
            className="block"
          />
          {!psdData && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs text-gray-600 font-mono">
                {playing ? 'Waiting for spectrum data...' : 'Press Listen to start receiving'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Frequency Dial ── */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 mb-8">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wider text-gray-600">Tuning</span>
          <span className="text-xs font-mono text-gray-500">{formatFreq(freq)} MHz</span>
        </div>
        <input
          type="range"
          min={24e6}
          max={1766e6}
          step={1000}
          value={freq}
          onChange={(e) => {
            const f = parseFloat(e.target.value)
            setFreq(f)
            setFreqInput((f / 1e6).toFixed(3))
            setActivePreset(null)
          }}
          onMouseUp={() => tune(freq, mode)}
          onTouchEnd={() => tune(freq, mode)}
          className="w-full h-3 bg-gray-800 rounded-full appearance-none cursor-pointer accent-sky-500"
        />
        <div className="flex justify-between text-[9px] text-gray-600 mt-1 font-mono">
          <span>24 MHz</span>
          <span>FM</span>
          <span>AIR</span>
          <span>2m</span>
          <span>VHF</span>
          <span>UHF</span>
          <span>P25</span>
          <span>1090</span>
          <span>1766 MHz</span>
        </div>
      </div>

      {/* ── Preset Banks ── */}
      <h2 className="text-xl font-semibold mb-4">Station Presets</h2>
      <div className="space-y-4 mb-8">
        {PRESET_GROUPS.map(group => {
          const c = colorMap[group.color] || colorMap.emerald
          return (
            <div key={group.name} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              <div className={`px-4 py-2 border-b border-gray-800/50 flex items-center gap-2`}>
                <div className={`w-2 h-2 rounded-full ${c.dot}`} />
                <span className={`text-xs font-semibold uppercase tracking-wider ${c.text}`}>{group.name}</span>
                <span className="text-[10px] text-gray-600 ml-auto">{group.presets.length} stations</span>
              </div>
              <div className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {group.presets.map(p => {
                  const isActive = activePreset === p.label && Math.abs(freq - p.freq) < 1e4
                  return (
                    <button
                      key={p.label}
                      onClick={() => tune(p.freq, p.mode, p.label)}
                      className={`text-left rounded-lg px-3 py-2 border transition-all ${
                        isActive
                          ? `${c.bg} ${c.border} ring-1 ${c.ring}`
                          : 'border-gray-800 hover:border-gray-700 bg-gray-800/30 hover:bg-gray-800/60'
                      }`}
                    >
                      <div className={`text-xs font-semibold ${isActive ? c.text : 'text-gray-300'}`}>
                        {p.label}
                      </div>
                      <div className="text-[10px] font-mono text-gray-500">
                        {(p.freq / 1e6).toFixed(3)} {modeLabel(p.mode)}
                      </div>
                      {p.sub && (
                        <div className="text-[10px] text-gray-600 mt-0.5">{p.sub}</div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
