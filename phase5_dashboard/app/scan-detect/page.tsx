'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import SignalFlowDiagram from '@/components/SignalFlowDiagram'

// Leaflet needs window — dynamic import with SSR disabled
const AircraftMap = dynamic(() => import('@/components/AircraftMap'), { ssr: false })
import {
  scanPipelineChain,
  defaultScanBands,
  demoDetections,
  demoAircraft,
  type ScanDetection,
  type ScannerStatus,
  type TrackedAircraft,
} from '@/data/scan-detect'

// Color map: dark blue → cyan → yellow → red (matches WaterfallDisplay)
function intensityToColor(value: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, value))
  if (t < 0.25) {
    const s = t / 0.25
    return [0, 0, Math.round(80 + 100 * s)]
  }
  if (t < 0.5) {
    const s = (t - 0.25) / 0.25
    return [0, Math.round(200 * s), Math.round(180 + 75 * s)]
  }
  if (t < 0.75) {
    const s = (t - 0.5) / 0.25
    return [Math.round(255 * s), Math.round(200 + 55 * s), Math.round(255 - 200 * s)]
  }
  const s = (t - 0.75) / 0.25
  return [255, Math.round(255 - 200 * s), Math.round(55 - 55 * s)]
}

function formatFreq(hz: number): string {
  if (hz >= 1e9) return `${(hz / 1e9).toFixed(3)} GHz`
  return `${(hz / 1e6).toFixed(3)} MHz`
}

function confidenceBar(confidence: number | null) {
  if (confidence === null) return <span className="text-xs text-gray-600">—</span>
  const pct = Math.round(confidence * 100)
  const color = pct >= 90 ? 'bg-emerald-500' : pct >= 75 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-gray-400">{pct}%</span>
    </div>
  )
}

function modBadge(mod: string | null) {
  if (!mod) return <span className="text-xs text-gray-600">unknown</span>
  const colors: Record<string, string> = {
    WBFM: 'bg-emerald-900/50 border-emerald-700 text-emerald-300',
    'AM-DSB': 'bg-blue-900/50 border-blue-700 text-blue-300',
    'AM-SSB': 'bg-blue-900/50 border-blue-700 text-blue-300',
    BPSK: 'bg-fuchsia-900/50 border-fuchsia-700 text-fuchsia-300',
    QPSK: 'bg-purple-900/50 border-purple-700 text-purple-300',
    '8PSK': 'bg-violet-900/50 border-violet-700 text-violet-300',
    CPFSK: 'bg-amber-900/50 border-amber-700 text-amber-300',
    GFSK: 'bg-amber-900/50 border-amber-700 text-amber-300',
    QAM16: 'bg-cyan-900/50 border-cyan-700 text-cyan-300',
    QAM64: 'bg-teal-900/50 border-teal-700 text-teal-300',
    PAM4: 'bg-orange-900/50 border-orange-700 text-orange-300',
  }
  const style = colors[mod] || 'bg-gray-800 border-gray-600 text-gray-400'
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${style}`}>
      {mod}
    </span>
  )
}

function protocolBadge(protocol: string | null) {
  if (!protocol) return null
  const colors: Record<string, string> = {
    adsb: 'bg-sky-900/50 border-sky-700 text-sky-300',
    aprs: 'bg-lime-900/50 border-lime-700 text-lime-300',
    satellite_apt: 'bg-indigo-900/50 border-indigo-700 text-indigo-300',
    satellite_lrpt: 'bg-indigo-900/50 border-indigo-700 text-indigo-300',
    satellite_lrit: 'bg-indigo-900/50 border-indigo-700 text-indigo-300',
    pocsag: 'bg-rose-900/50 border-rose-700 text-rose-300',
  }
  const labels: Record<string, string> = {
    adsb: 'ADS-B',
    aprs: 'APRS',
    satellite_apt: 'SAT-APT',
    satellite_lrpt: 'SAT-LRPT',
    satellite_lrit: 'SAT-LRIT',
    pocsag: 'POCSAG',
  }
  const style = colors[protocol] || 'bg-gray-800 border-gray-600 text-gray-400'
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${style}`}>
      {labels[protocol] || protocol}
    </span>
  )
}

export default function ScanDetectPage() {
  const [status, setStatus] = useState<ScannerStatus>({
    running: false,
    scan_id: null,
    current_freq_hz: 0,
    total_detections: 0,
  })
  const [detections, setDetections] = useState<ScanDetection[]>(demoDetections)
  const [aircraft, setAircraft] = useState<TrackedAircraft[]>(demoAircraft)
  const [trails, setTrails] = useState<Record<string, [number, number][]>>(() => {
    // Initialize demo trails
    const t: Record<string, [number, number][]> = {}
    demoAircraft.forEach(ac => {
      if (ac.latitude != null && ac.longitude != null) {
        // Generate a short demo trail behind each aircraft
        const hdg = ((ac.heading_deg ?? 0) + 180) * Math.PI / 180
        const points: [number, number][] = []
        for (let i = 5; i >= 0; i--) {
          const dist = i * 0.05
          points.push([
            ac.latitude! + Math.cos(hdg) * dist,
            ac.longitude! + Math.sin(hdg) * dist,
          ])
        }
        t[ac.icao_hex] = points
      }
    })
    return t
  })
  const [wsConnected, setWsConnected] = useState(false)
  const [scanMode, setScanMode] = useState<'sweep' | 'watch' | 'band_list'>('band_list')
  const [startFreq, setStartFreq] = useState('87.5')
  const [stopFreq, setStopFreq] = useState('108')
  const [watchFreq, setWatchFreq] = useState('162.475')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const waterfallBuffer = useRef<number[][]>([])
  const wsRef = useRef<WebSocket | null>(null)

  // Poll scanner status
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/scanner')
        const data = await res.json()
        setStatus(data)
      } catch {
        // Scanner not available
      }
    }
    poll()
    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [])

  // WebSocket connection for live data
  useEffect(() => {
    const connectWs = () => {
      try {
        // Auto-detect WebSocket URL: use localhost for local dev,
        // or proxy through scanner subdomain for remote access
        const wsUrl = window.location.hostname === 'localhost'
          ? 'ws://localhost:8765'
          : `wss://scanner.${window.location.hostname.replace('groundlink.', '')}`
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => setWsConnected(true)
        ws.onclose = () => {
          setWsConnected(false)
          // Reconnect after delay
          setTimeout(connectWs, 5000)
        }
        ws.onerror = () => ws.close()

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data)

          if (data.type === 'spectrum') {
            // Add to waterfall buffer
            waterfallBuffer.current.push(data.psd_dbfs)
            if (waterfallBuffer.current.length > 300) {
              waterfallBuffer.current.shift()
            }
            drawWaterfall(data.psd_dbfs, data.center_freq_hz, data.bandwidth_hz)
          }

          if (data.type === 'detection') {
            const newDetection: ScanDetection = {
              id: Date.now(),
              detected_at: data.timestamp,
              frequency_hz: data.frequency_hz,
              bandwidth_hz: data.bandwidth_hz,
              snr_db: data.snr_db,
              modulation: data.modulation,
              confidence: data.confidence,
              model_used: 'vtcnn2',
              inference_ms: null,
              known_signal: data.known_signal,
              demod_type: data.demod_type,
              demod_preview: data.demod_preview,
              protocol: data.protocol || null,
              decoded_summary: data.decoded_summary || null,
              decoded_data: data.decoded_data || null,
            }
            setDetections(prev => [newDetection, ...prev].slice(0, 200))

            // Update aircraft table and trails from ADS-B detections
            if (data.protocol === 'adsb' && data.decoded_data?.aircraft_table) {
              const table = data.decoded_data.aircraft_table as Record<string, TrackedAircraft>
              const acList = Object.values(table)
              setAircraft(acList)

              // Append new positions to trails
              setTrails(prev => {
                const next = { ...prev }
                acList.forEach(ac => {
                  if (ac.latitude != null && ac.longitude != null) {
                    const existing = next[ac.icao_hex] || []
                    const lastPos = existing[existing.length - 1]
                    // Only add if position actually changed
                    if (!lastPos || lastPos[0] !== ac.latitude || lastPos[1] !== ac.longitude) {
                      next[ac.icao_hex] = [...existing, [ac.latitude!, ac.longitude!] as [number, number]].slice(-100)
                    }
                  }
                })
                return next
              })
            }
          }

          if (data.type === 'status') {
            setStatus(prev => ({ ...prev, ...data }))
          }
        }
      } catch {
        setTimeout(connectWs, 5000)
      }
    }

    connectWs()
    return () => {
      wsRef.current?.close()
    }
  }, [])

  const drawWaterfall = useCallback((psd: number[], centerFreq: number, bandwidth: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height

    // Shift existing content down by 1 pixel
    const imageData = ctx.getImageData(0, 0, w, h - 1)
    ctx.putImageData(imageData, 0, 1)

    // Draw new spectrum row at top
    const minDb = -80
    const maxDb = -20
    const binWidth = w / psd.length

    for (let i = 0; i < psd.length; i++) {
      const normalized = Math.max(0, Math.min(1, (psd[i] - minDb) / (maxDb - minDb)))
      const [r, g, b] = intensityToColor(normalized)
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.fillRect(i * binWidth, 0, Math.ceil(binWidth), 1)
    }
  }, [])

  // Initialize canvas with static waterfall
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = 800
    canvas.height = 300

    // Generate initial static waterfall
    for (let row = 0; row < 300; row++) {
      for (let col = 0; col < 800; col++) {
        let power = 0.1 + Math.random() * 0.15
        const centerDist = Math.abs(col - 400) / 400
        if (centerDist < 0.06) {
          power += 0.5 * (1 - centerDist / 0.06) + Math.random() * 0.1
        }
        if (Math.abs(col - 250) / 400 < 0.03) {
          power += 0.3 + Math.random() * 0.05
        }
        const timeFade = 0.8 + 0.2 * Math.sin(row / 300 * Math.PI * 3)
        power *= timeFade
        const [r, g, b] = intensityToColor(power)
        ctx.fillStyle = `rgb(${r},${g},${b})`
        ctx.fillRect(col, row, 1, 1)
      }
    }
  }, [])

  const handleStartStop = async () => {
    try {
      const action = status.running ? 'stop' : 'start'
      await fetch('/api/scanner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          config: action === 'start' ? {
            mode: scanMode,
            start_freq_mhz: parseFloat(startFreq),
            stop_freq_mhz: parseFloat(stopFreq),
            watch_freq_mhz: parseFloat(watchFreq),
          } : undefined,
        }),
      })
    } catch {
      // Handle error
    }
  }

  const avgConfidence = detections.filter(d => d.confidence !== null).reduce((sum, d) => sum + (d.confidence || 0), 0)
    / (detections.filter(d => d.confidence !== null).length || 1)
  const uniqueMods = new Set(detections.map(d => d.modulation).filter(Boolean))

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Scan & Detect</h1>
        <p className="text-gray-400">
          SDR-powered broadband signal scanning with real-time AMR classification and demodulation
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Scanner Status</div>
          <div className="flex items-center gap-2 mt-1">
            <div className={`w-2 h-2 rounded-full ${status.running ? 'bg-emerald-400 animate-pulse' : wsConnected ? 'bg-amber-400' : 'bg-gray-600'}`} />
            <span className={`text-lg font-bold ${status.running ? 'text-emerald-400' : 'text-gray-400'}`}>
              {status.running ? 'Scanning' : wsConnected ? 'Idle' : 'Offline'}
            </span>
          </div>
          <div className="text-sm text-gray-500 font-mono mt-1">
            {status.running ? formatFreq(status.current_freq_hz) : 'No active scan'}
          </div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Total Detections</div>
          <div className="text-2xl font-bold text-fuchsia-400">{detections.length}</div>
          <div className="text-sm text-gray-500">Signals found</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Modulations Seen</div>
          <div className="text-2xl font-bold text-fuchsia-400">{uniqueMods.size}</div>
          <div className="text-sm text-gray-500">Unique types</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Aircraft Tracked</div>
          <div className="text-2xl font-bold text-sky-400">{aircraft.length}</div>
          <div className="text-sm text-gray-500">Via ADS-B decode</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Protocols Decoded</div>
          <div className="text-2xl font-bold text-lime-400">
            {new Set(detections.map(d => d.protocol).filter(Boolean)).size}
          </div>
          <div className="text-sm text-gray-500">ADS-B, APRS, SAT, POCSAG</div>
        </div>
      </div>

      {/* Scan Control Panel */}
      <h2 className="text-xl font-semibold mb-4">Scan Control</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Mode</label>
            <select
              value={scanMode}
              onChange={(e) => setScanMode(e.target.value as 'sweep' | 'watch' | 'band_list')}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
            >
              <option value="sweep">Sweep</option>
              <option value="watch">Watch</option>
              <option value="band_list">Band List</option>
            </select>
          </div>

          {scanMode === 'sweep' && (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Start (MHz)</label>
                <input
                  type="number"
                  value={startFreq}
                  onChange={(e) => setStartFreq(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm font-mono w-28"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Stop (MHz)</label>
                <input
                  type="number"
                  value={stopFreq}
                  onChange={(e) => setStopFreq(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm font-mono w-28"
                />
              </div>
            </>
          )}

          {scanMode === 'watch' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Frequency (MHz)</label>
              <input
                type="number"
                value={watchFreq}
                onChange={(e) => setWatchFreq(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm font-mono w-32"
              />
            </div>
          )}

          <button
            onClick={handleStartStop}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              status.running
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
          >
            {status.running ? 'Stop Scan' : 'Start Scan'}
          </button>

          <div className="ml-auto flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-400' : 'bg-gray-600'}`} />
            <span className="text-xs text-gray-500">
              {wsConnected ? 'WebSocket connected' : 'WebSocket disconnected'}
            </span>
          </div>
        </div>
      </div>

      {/* Scanner Pipeline */}
      <h2 className="text-xl font-semibold mb-4">Scanner Pipeline</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8">
        <SignalFlowDiagram chain={scanPipelineChain} />
      </div>

      {/* Live Waterfall */}
      <h2 className="text-xl font-semibold mb-4">Live Waterfall</h2>
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Spectrum Waterfall</h3>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            {status.running && <span>Tuned: {formatFreq(status.current_freq_hz)}</span>}
            <span>BW: 2.4 MHz</span>
          </div>
        </div>
        <div className="overflow-hidden rounded">
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '300px', imageRendering: 'pixelated' }}
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
          <span className="text-[10px] text-gray-600 ml-auto">
            {wsConnected ? 'Live stream active' : 'Static preview — connect scanner for live data'}
          </span>
        </div>
      </div>

      {/* Detection Log */}
      <h2 className="text-xl font-semibold mb-4">Detection Log</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-left text-gray-400">
              <th className="py-2 pr-4">Time</th>
              <th className="py-2 pr-4">Frequency</th>
              <th className="py-2 pr-4">BW</th>
              <th className="py-2 pr-4">SNR</th>
              <th className="py-2 pr-4">Modulation</th>
              <th className="py-2 pr-4 w-32">Confidence</th>
              <th className="py-2 pr-4">Known Signal</th>
              <th className="py-2 pr-4">Protocol</th>
              <th className="py-2">Decoded</th>
            </tr>
          </thead>
          <tbody>
            {detections.map((det) => (
              <tr key={det.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                <td className="py-1.5 pr-4 font-mono text-xs text-gray-400">
                  {new Date(det.detected_at).toLocaleTimeString()}
                </td>
                <td className="py-1.5 pr-4 font-mono text-gray-300">
                  {formatFreq(det.frequency_hz)}
                </td>
                <td className="py-1.5 pr-4 font-mono text-gray-400 text-xs">
                  {(det.bandwidth_hz / 1000).toFixed(0)} kHz
                </td>
                <td className="py-1.5 pr-4 font-mono text-gray-400">
                  {det.snr_db.toFixed(1)} dB
                </td>
                <td className="py-1.5 pr-4">{modBadge(det.modulation)}</td>
                <td className="py-1.5 pr-4">{confidenceBar(det.confidence)}</td>
                <td className="py-1.5 pr-4 text-gray-300 text-xs">
                  {det.known_signal || <span className="text-gray-600">—</span>}
                </td>
                <td className="py-1.5 pr-4">
                  {protocolBadge(det.protocol)}
                </td>
                <td className="py-1.5">
                  {det.decoded_summary ? (
                    <span className="text-xs text-gray-300 truncate block max-w-[200px]" title={det.decoded_summary}>
                      {det.decoded_summary}
                    </span>
                  ) : det.demod_type ? (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      det.demod_type === 'audio'
                        ? 'bg-emerald-900/50 border-emerald-700 text-emerald-300'
                        : 'bg-fuchsia-900/50 border-fuchsia-700 text-fuchsia-300'
                    }`}>
                      {det.demod_type}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-600">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recent Detection Cards */}
      <h2 className="text-xl font-semibold mb-4">Recent Detections</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {detections.slice(0, 6).map((det) => (
          <div key={det.id} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <div className="flex items-center justify-between mb-2">
              <div className="font-mono text-sm text-gray-300">{formatFreq(det.frequency_hz)}</div>
              {modBadge(det.modulation)}
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">SNR</span>
                <span className="font-mono">{det.snr_db.toFixed(1)} dB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Bandwidth</span>
                <span className="font-mono">{(det.bandwidth_hz / 1000).toFixed(0)} kHz</span>
              </div>
              {det.confidence !== null && (
                <div>
                  <span className="text-gray-500 text-xs">Confidence</span>
                  {confidenceBar(det.confidence)}
                </div>
              )}
              {det.known_signal && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Match</span>
                  <span className="text-emerald-400 text-xs">{det.known_signal}</span>
                </div>
              )}
              {det.protocol && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Protocol</span>
                  {protocolBadge(det.protocol)}
                </div>
              )}
              {det.decoded_summary && (
                <div className="mt-2 p-2 bg-gray-800/50 rounded text-xs text-gray-300">
                  {det.decoded_summary}
                </div>
              )}
              {!det.decoded_summary && det.demod_preview && (
                <div className="mt-2 p-2 bg-gray-800/50 rounded text-xs font-mono text-gray-400 truncate">
                  {det.demod_preview}
                </div>
              )}
            </div>
            <div className="text-xs text-gray-600 mt-2">
              {new Date(det.detected_at).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {/* Aircraft Map & Tracking */}
      {aircraft.length > 0 && (
        <>
          <h2 className="text-xl font-semibold mb-4">Aircraft Tracking (ADS-B)</h2>
          <div className="mb-6">
            <AircraftMap aircraft={aircraft} trails={trails} height={450} />
          </div>
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-left text-gray-400">
                  <th className="py-2 pr-4">ICAO</th>
                  <th className="py-2 pr-4">Callsign</th>
                  <th className="py-2 pr-4">Latitude</th>
                  <th className="py-2 pr-4">Longitude</th>
                  <th className="py-2 pr-4">Altitude</th>
                  <th className="py-2 pr-4">Speed</th>
                  <th className="py-2 pr-4">Heading</th>
                  <th className="py-2">V/S</th>
                </tr>
              </thead>
              <tbody>
                {aircraft.map((ac) => (
                  <tr key={ac.icao_hex} className="border-b border-gray-800/50">
                    <td className="py-1.5 pr-4 font-mono text-sky-400">{ac.icao_hex}</td>
                    <td className="py-1.5 pr-4 font-medium">{ac.callsign || '—'}</td>
                    <td className="py-1.5 pr-4 font-mono text-gray-300">{ac.latitude?.toFixed(4) ?? '—'}</td>
                    <td className="py-1.5 pr-4 font-mono text-gray-300">{ac.longitude?.toFixed(4) ?? '—'}</td>
                    <td className="py-1.5 pr-4 font-mono text-gray-300">
                      {ac.altitude_ft != null ? `FL${Math.round(ac.altitude_ft / 100)}` : '—'}
                    </td>
                    <td className="py-1.5 pr-4 font-mono text-gray-400">
                      {ac.ground_speed_kt != null ? `${ac.ground_speed_kt.toFixed(0)} kt` : '—'}
                    </td>
                    <td className="py-1.5 pr-4 font-mono text-gray-400">
                      {ac.heading_deg != null ? `${ac.heading_deg.toFixed(0)}°` : '—'}
                    </td>
                    <td className="py-1.5 font-mono text-gray-400">
                      {ac.vertical_rate_fpm != null ? (
                        <span className={ac.vertical_rate_fpm > 0 ? 'text-emerald-400' : ac.vertical_rate_fpm < 0 ? 'text-amber-400' : ''}>
                          {ac.vertical_rate_fpm > 0 ? '+' : ''}{ac.vertical_rate_fpm} fpm
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Scan Bands */}
      <h2 className="text-xl font-semibold mb-4">Configured Scan Bands</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {defaultScanBands.map(band => (
          <div key={band.name} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <h3 className="font-semibold text-sm mb-1">{band.name}</h3>
            <div className="text-xs font-mono text-gray-400 mb-2">
              {band.startMhz} — {band.stopMhz} MHz
            </div>
            <p className="text-xs text-gray-500">{band.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
