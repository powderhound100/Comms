'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import AircraftMap from '@/components/AircraftMap'
import type { TrackedAircraft, AdsbSources, PiHealth, PiSlot } from '@/data/scan-detect'

const FlightPathModal = dynamic(() => import('@/components/FlightPathModal'), { ssr: false })
import {
  rfParameters,
  messageTypes,
  hardware,
  software,
  integrationScenarios,
  decodeChain,
} from '@/data/ads-b'
import SignalFlowDiagram from '@/components/SignalFlowDiagram'
import SdrModeBar from '@/components/SdrModeBar'
import { useSdr } from '@/hooks/use-sdr'

// ── Spectrum canvas hook (same pattern as radio page) ──

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

    ctx.fillStyle = '#0a0e14'
    ctx.fillRect(0, 0, w, h)

    // Grid
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

    // Fill gradient
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
  }, [canvasRef, psdData, centerFreq, bandwidth])
}

// ── Row helper ──

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-gray-800/50">
      <td className="py-1.5 text-gray-400 w-48">{label}</td>
      <td className="py-1.5 font-mono">{value}</td>
    </tr>
  )
}

// ── Main page ──

export default function ADSBPage() {
  const [connected, setConnected] = useState(false)
  const [aircraft, setAircraft] = useState<TrackedAircraft[]>([])
  const [trails, setTrails] = useState<Record<string, [number, number][]>>({})
  const [psdData, setPsdData] = useState<number[] | null>(null)
  const totalMsgsRef = useRef(0)
  const msgRateRef = useRef(0)
  const aircraftCountRef = useRef(0)
  // DOM refs for direct stat updates (bypass React re-render)
  const totalMsgsEl = useRef<HTMLDivElement>(null)
  const msgRateEl = useRef<HTMLDivElement>(null)
  const aircraftCountEl = useRef<HTMLDivElement>(null)
  const [showReference, setShowReference] = useState(false)
  const [sortCol, setSortCol] = useState<string>('callsign')
  const [sortAsc, setSortAsc] = useState(true)

  // Aircraft log state
  interface LoggedAircraft {
    icao: string
    callsign: string | null
    first_seen: string
    last_seen: string
    total_msgs: number
    sessions: number
    last_pos: { lat: number; lon: number; alt_ft: number | null; gs_kt: number | null; hdg: number | null; ts: string } | null
  }
  const [logData, setLogData] = useState<{ unique_aircraft: number; today: number; total_sightings: number; aircraft: LoggedAircraft[] }>({ unique_aircraft: 0, today: 0, total_sightings: 0, aircraft: [] })
  const [showLog, setShowLog] = useState(false)
  const [selectedTrackIcao, setSelectedTrackIcao] = useState<string | null>(null)

  // SDR mode control
  const { status: sdrStatus, loading: sdrLoading, isMyMode, isOtherMode, start: sdrStart, stop: sdrStop } = useSdr('adsb')
  const [testMode, setTestMode] = useState(false)
  const [gain, setGain] = useState(496)

  // Dual-frequency state — refs for high-frequency updates, direct DOM
  const [psdData978, setPsdData978] = useState<number[] | null>(null)
  const source1090Ref = useRef<AdsbSources['1090'] | null>(null)
  const source978Ref = useRef<AdsbSources['978'] | null>(null)
  const source1090El = useRef<HTMLDivElement>(null)
  const source978El = useRef<HTMLDivElement>(null)

  // Pi health state
  const [piHealth, setPiHealth] = useState<PiHealth | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const canvas978Ref = useRef<HTMLCanvasElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const trailsRef = useRef<Record<string, [number, number][]>>({})

  useSpectrumCanvas(canvasRef, psdData, 1090e6, 2e6)
  useSpectrumCanvas(canvas978Ref, psdData978, 978e6, 2.083e6)

  // Poll aircraft log
  useEffect(() => {
    async function fetchLog() {
      try {
        const res = await fetch('/api/adsb/log')
        if (res.ok) setLogData(await res.json())
      } catch { /* offline */ }
    }
    fetchLog()
    const timer = setInterval(fetchLog, 10000)
    return () => clearInterval(timer)
  }, [])

  // Poll Pi health
  useEffect(() => {
    async function fetchPiHealth() {
      try {
        const res = await fetch('/api/pi/health')
        if (res.ok) {
          const data = await res.json()
          if (!data.error) setPiHealth(data)
        }
      } catch { /* offline */ }
    }
    fetchPiHealth()
    const timer = setInterval(fetchPiHealth, 5000)
    return () => clearInterval(timer)
  }, [])

  const handleStart = useCallback(async () => {
    await sdrStart({ gain, test: testMode })
  }, [sdrStart, gain, testMode])

  const handleStop = useCallback(async () => {
    await sdrStop()
    setAircraft([])
    setTrails({})
    trailsRef.current = {}
    setPsdData(null)
    totalMsgsRef.current = 0
    msgRateRef.current = 0
    aircraftCountRef.current = 0
    if (totalMsgsEl.current) totalMsgsEl.current.textContent = '0'
    if (msgRateEl.current) msgRateEl.current.textContent = '0.0/s'
    if (aircraftCountEl.current) aircraftCountEl.current.textContent = '0'
  }, [sdrStop])

  // WebSocket connection — when adsb or adsb_dual mode is active
  const isAdsbActive = isMyMode || sdrStatus.active_mode === 'adsb_dual'
  useEffect(() => {
    if (!isAdsbActive) {
      setConnected(false)
      return
    }

    const isLocal = typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    const wsUrl = isLocal
      ? 'ws://localhost:8771'
      : 'wss://adsb.powderhound420.com'

    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    function connect() {
      ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => setConnected(true)
      ws.onclose = () => {
        setConnected(false)
        reconnectTimer = setTimeout(connect, 3000)
      }
      ws.onerror = () => { /* triggers onclose */ }

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        try {
          const data = JSON.parse(event.data)

          if (data.type === 'aircraft') {
            const acList: TrackedAircraft[] = (data.aircraft || []).map((a: {
              icao: string
              callsign: string | null
              lat: number | null
              lon: number | null
              alt_ft: number | null
              gs_kt: number | null
              hdg: number | null
              vr_fpm: number | null
              on_ground: boolean
              source?: '1090' | '978' | 'both'
            }) => ({
              icao_hex: a.icao,
              callsign: a.callsign || null,
              latitude: a.lat ?? null,
              longitude: a.lon ?? null,
              altitude_ft: a.alt_ft ?? null,
              ground_speed_kt: a.gs_kt ?? null,
              heading_deg: a.hdg ?? null,
              vertical_rate_fpm: a.vr_fpm ?? null,
              squawk: null,
              on_ground: a.on_ground ?? false,
              source: a.source ?? '1090',
            }))

            // Stable state update — return same reference when data unchanged
            setAircraft(prev => {
              if (prev.length === acList.length && prev.every((p, i) => {
                const n = acList[i]
                return p.icao_hex === n.icao_hex && p.latitude === n.latitude &&
                  p.longitude === n.longitude && p.altitude_ft === n.altitude_ft &&
                  p.callsign === n.callsign && p.heading_deg === n.heading_deg &&
                  p.ground_speed_kt === n.ground_speed_kt &&
                  p.vertical_rate_fpm === n.vertical_rate_fpm && p.source === n.source
              })) return prev
              return acList
            })
            // Update stats via refs + direct DOM (no React re-render)
            totalMsgsRef.current = data.total_msgs ?? 0
            msgRateRef.current = data.msg_rate ?? 0
            aircraftCountRef.current = data.aircraft_count ?? 0
            if (totalMsgsEl.current) totalMsgsEl.current.textContent = totalMsgsRef.current.toLocaleString()
            if (msgRateEl.current) msgRateEl.current.textContent = `${msgRateRef.current.toFixed(1)}/s`
            if (aircraftCountEl.current) aircraftCountEl.current.textContent = String(aircraftCountRef.current)

            // Parse dual-source metadata via refs + direct DOM
            if (data.sources) {
              source1090Ref.current = data.sources['1090'] || null
              source978Ref.current = data.sources['978'] || null
              if (source1090El.current) {
                const s = source1090Ref.current
                source1090El.current.innerHTML = `<div class="w-2 h-2 rounded-full ${s?.connected ? 'bg-cyan-400' : 'bg-gray-600'}"></div><span class="text-sm font-bold text-cyan-400">${s?.aircraft_count ?? 0}</span><span class="text-xs text-gray-500">${(s?.msg_rate ?? 0).toFixed(0)}/s</span>`
              }
              if (source978El.current) {
                const s = source978Ref.current
                source978El.current.innerHTML = `<div class="w-2 h-2 rounded-full ${s?.connected ? 'bg-orange-400' : 'bg-gray-600'}"></div><span class="text-sm font-bold text-orange-400">${s?.aircraft_count ?? 0}</span><span class="text-xs text-gray-500">${(s?.msg_rate ?? 0).toFixed(0)}/s</span>`
              }
            }

            // Update trails — only trigger re-render when a trail actually changed
            const newTrails = { ...trailsRef.current }
            let trailsChanged = false
            for (const ac of acList) {
              if (ac.latitude != null && ac.longitude != null) {
                if (!newTrails[ac.icao_hex]) { newTrails[ac.icao_hex] = []; trailsChanged = true }
                const trail = newTrails[ac.icao_hex]
                const last = trail[trail.length - 1]
                if (!last || last[0] !== ac.latitude || last[1] !== ac.longitude) {
                  trail.push([ac.latitude, ac.longitude])
                  if (trail.length > 100) trail.shift()
                  trailsChanged = true
                }
              }
            }
            // Remove trails for aircraft no longer in list
            const activeIcaos = new Set(acList.map(a => a.icao_hex))
            for (const icao of Object.keys(newTrails)) {
              if (!activeIcaos.has(icao)) { delete newTrails[icao]; trailsChanged = true }
            }
            trailsRef.current = newTrails
            if (trailsChanged) setTrails({ ...newTrails })

          } else if (data.type === 'spectrum') {
            if (data.center_freq_hz === 978000000) {
              setPsdData978(data.psd_dbfs)
            } else {
              setPsdData(data.psd_dbfs)
            }
          }
        } catch { /* skip malformed */ }
      }
    }

    connect()

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) ws.close()
      wsRef.current = null
    }
  }, [isAdsbActive])

  // Sort aircraft for table — memoized to avoid re-render from unrelated state changes
  const sortedAircraft = useMemo(() => [...aircraft].sort((a, b) => {
    let av: string | number | null = null
    let bv: string | number | null = null
    switch (sortCol) {
      case 'callsign': av = a.callsign; bv = b.callsign; break
      case 'icao': av = a.icao_hex; bv = b.icao_hex; break
      case 'alt': av = a.altitude_ft; bv = b.altitude_ft; break
      case 'speed': av = a.ground_speed_kt; bv = b.ground_speed_kt; break
      case 'heading': av = a.heading_deg; bv = b.heading_deg; break
      case 'vr': av = a.vertical_rate_fpm; bv = b.vertical_rate_fpm; break
    }
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'string' && typeof bv === 'string')
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number)
  }), [aircraft, sortCol, sortAsc])

  const handleSort = (col: string) => {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(true) }
  }

  const sortIcon = (col: string) =>
    sortCol === col ? (sortAsc ? ' \u25B2' : ' \u25BC') : ''

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">ADS-B Aircraft Tracker</h1>
        <p className="text-gray-400 text-sm">
          Dual-frequency ADS-B tracking — 1090 MHz + 978 MHz UAT via Pi SDR node
        </p>
      </div>

      <SdrModeBar
        myMode="adsb"
        isMyMode={isMyMode}
        isOtherMode={isOtherMode}
        activeMode={sdrStatus.active_mode}
        loading={sdrLoading}
        pid={sdrStatus.pid}
        uptime={sdrStatus.uptime_s}
        log={sdrStatus.log}
        onStart={handleStart}
        onStop={handleStop}
      >
        {/* Gain */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Gain</label>
          <input
            type="number"
            value={gain}
            onChange={e => setGain(parseInt(e.target.value) || 0)}
            disabled={isMyMode}
            className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm font-mono text-gray-200 disabled:opacity-40"
          />
        </div>
        {/* Test mode */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={testMode}
            onChange={e => setTestMode(e.target.checked)}
            disabled={isMyMode}
            className="rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500 disabled:opacity-40"
          />
          <span className={`text-sm ${testMode ? 'text-amber-400' : 'text-gray-400'}`}>
            Test mode
          </span>
        </label>
      </SdrModeBar>

      {/* Status + Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Status</div>
          <div className="flex items-center gap-2 mt-1">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
            <span className={`text-sm font-medium ${connected ? 'text-emerald-400' : 'text-red-400'}`}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
        <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">1090 MHz</div>
          <div ref={source1090El} className="flex items-center gap-2 mt-1">
            <div className="w-2 h-2 rounded-full bg-gray-600" />
            <span className="text-sm font-bold text-cyan-400">0</span>
            <span className="text-xs text-gray-500">0/s</span>
          </div>
        </div>
        <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">978 MHz</div>
          <div ref={source978El} className="flex items-center gap-2 mt-1">
            <div className="w-2 h-2 rounded-full bg-gray-600" />
            <span className="text-sm font-bold text-orange-400">0</span>
            <span className="text-xs text-gray-500">0/s</span>
          </div>
        </div>
        <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Aircraft</div>
          <div ref={aircraftCountEl} className="text-lg font-bold text-cyan-400 mt-1">0</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Msg Rate</div>
          <div ref={msgRateEl} className="text-lg font-bold text-cyan-400 mt-1">0.0/s</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Total Msgs</div>
          <div ref={totalMsgsEl} className="text-lg font-bold text-cyan-400 mt-1">0</div>
        </div>
      </div>

      {/* Aircraft Map */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 mb-6 overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-800 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-300">Aircraft Map</span>
          <span className="text-xs text-gray-500 font-mono">{aircraft.filter(a => a.latitude != null).length} with position</span>
        </div>
        <AircraftMap aircraft={aircraft} trails={trails} height={500} />
      </div>

      {/* 1090 MHz Spectrum */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 mb-6 overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-800">
          <span className="text-sm font-medium text-gray-300">1090 MHz Spectrum</span>
          <span className="text-xs text-gray-500 ml-3 font-mono">2 MHz bandwidth</span>
        </div>
        <div className="relative">
          <canvas
            ref={canvasRef}
            width={1024}
            height={180}
            className="w-full block"
            style={{ imageRendering: 'pixelated' }}
          />
          {!psdData && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs text-gray-600 font-mono">
                {connected ? 'Waiting for spectrum data...' : 'Connect to see 1090 MHz spectrum'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 978 MHz Spectrum */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 mb-6 overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-800">
          <span className="text-sm font-medium text-orange-300">978 MHz UAT Spectrum</span>
          <span className="text-xs text-gray-500 ml-3 font-mono">2.08 MHz bandwidth</span>
        </div>
        <div className="relative">
          <canvas
            ref={canvas978Ref}
            width={1024}
            height={140}
            className="w-full block"
            style={{ imageRendering: 'pixelated' }}
          />
          {!psdData978 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs text-gray-600 font-mono">
                {connected ? 'Waiting for 978 MHz data...' : 'Connect to see UAT spectrum'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Aircraft Table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 mb-6 overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-800">
          <span className="text-sm font-medium text-gray-300">Tracked Aircraft</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-left">
                <th className="px-3 py-2 cursor-pointer hover:text-white" onClick={() => handleSort('icao')}>
                  ICAO{sortIcon('icao')}
                </th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2 cursor-pointer hover:text-white" onClick={() => handleSort('callsign')}>
                  Callsign{sortIcon('callsign')}
                </th>
                <th className="px-3 py-2 cursor-pointer hover:text-white" onClick={() => handleSort('alt')}>
                  Altitude{sortIcon('alt')}
                </th>
                <th className="px-3 py-2 cursor-pointer hover:text-white" onClick={() => handleSort('speed')}>
                  Speed{sortIcon('speed')}
                </th>
                <th className="px-3 py-2 cursor-pointer hover:text-white" onClick={() => handleSort('heading')}>
                  Heading{sortIcon('heading')}
                </th>
                <th className="px-3 py-2 cursor-pointer hover:text-white" onClick={() => handleSort('vr')}>
                  V/S{sortIcon('vr')}
                </th>
                <th className="px-3 py-2">Position</th>
              </tr>
            </thead>
            <tbody>
              {sortedAircraft.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-gray-600">
                    {connected ? 'Waiting for aircraft...' : 'Not connected — start adsb_server.py'}
                  </td>
                </tr>
              ) : (
                sortedAircraft.map(ac => (
                  <tr key={ac.icao_hex} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-3 py-1.5 font-mono text-amber-400">{ac.icao_hex}</td>
                    <td className="px-3 py-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        ac.source === '978' ? 'bg-orange-900/50 text-orange-300 border border-orange-700' :
                        ac.source === 'both' ? 'bg-purple-900/50 text-purple-300 border border-purple-700' :
                        'bg-cyan-900/50 text-cyan-300 border border-cyan-700'
                      }`}>
                        {ac.source ?? '1090'}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-medium">
                      {ac.callsign || <span className="text-gray-600">---</span>}
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {ac.altitude_ft != null
                        ? <span>FL{Math.round(ac.altitude_ft / 100)}<span className="text-gray-500 ml-1">({ac.altitude_ft.toLocaleString()} ft)</span></span>
                        : <span className="text-gray-600">---</span>
                      }
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {ac.ground_speed_kt != null
                        ? `${ac.ground_speed_kt.toFixed(0)} kt`
                        : <span className="text-gray-600">---</span>
                      }
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {ac.heading_deg != null
                        ? `${ac.heading_deg.toFixed(0)}\u00B0`
                        : <span className="text-gray-600">---</span>
                      }
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {ac.vertical_rate_fpm != null && ac.vertical_rate_fpm !== 0
                        ? <span className={ac.vertical_rate_fpm > 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {ac.vertical_rate_fpm > 0 ? '+' : ''}{ac.vertical_rate_fpm} fpm
                          </span>
                        : <span className="text-gray-600">---</span>
                      }
                    </td>
                    <td className="px-3 py-1.5 font-mono text-gray-400">
                      {ac.latitude != null && ac.longitude != null
                        ? `${ac.latitude.toFixed(3)}, ${ac.longitude.toFixed(3)}`
                        : <span className="text-gray-600">no fix</span>
                      }
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pi Status */}
      {piHealth && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 mb-6 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-800 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-300">Pi SDR Node</span>
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-gray-400">{piHealth.hostname}</span>
              <span className="text-xs font-mono text-gray-500">{piHealth.ip}</span>
              <span className={`text-xs font-mono ${
                piHealth.cpu_temp_c >= 75 ? 'text-red-400' :
                piHealth.cpu_temp_c >= 60 ? 'text-amber-400' :
                'text-emerald-400'
              }`}>
                {piHealth.cpu_temp_c.toFixed(1)}°C
              </span>
            </div>
          </div>
          <div className="p-4 space-y-2">
            {Object.values(piHealth.slots ?? {}).map((slot: any) => (
              <div key={slot.id} className="flex items-center gap-3 text-sm">
                <span className="text-gray-500 w-14">Slot {slot.id}</span>
                <span className="font-mono text-gray-300 w-28">{slot.mode ?? 'idle'}</span>
                <div className={`w-2 h-2 rounded-full ${
                  slot.status === 'running' ? 'bg-emerald-400' :
                  slot.status === 'error' ? 'bg-red-400' :
                  'bg-gray-600'
                }`} />
                <span className="text-xs text-gray-400">{slot.status}</span>
                {slot.uptime_s > 0 && (
                  <span className="text-xs text-gray-500 font-mono">
                    {Math.floor(slot.uptime_s / 3600)}h {Math.floor((slot.uptime_s % 3600) / 60)}m
                  </span>
                )}
              </div>
            ))}
            {piHealth.throttled && (
              <div className="text-xs text-red-400 mt-2">Thermal throttling active</div>
            )}
          </div>
        </div>
      )}

      {/* Decode Pipeline */}
      <h2 className="text-lg font-semibold mb-3">Decode Pipeline</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-6">
        <SignalFlowDiagram chain={decodeChain} />
      </div>

      {/* Collapsible Reference */}
      <button
        onClick={() => setShowReference(!showReference)}
        className="w-full text-left bg-gray-900 rounded-lg p-4 border border-gray-800 mb-4 hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">ADS-B Reference</h2>
          <span className="text-gray-400 text-sm">{showReference ? 'Hide' : 'Show'}</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">RF parameters, message types, hardware, software stack</p>
      </button>

      {showReference && (
        <div className="space-y-6 mb-8">
          {/* RF Parameters */}
          <div>
            <h3 className="text-sm font-semibold mb-2 text-gray-400">RF Parameters</h3>
            <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
              <table className="w-full text-sm">
                <tbody>
                  {rfParameters.map(p => (
                    <Row key={p.label} label={p.label} value={p.value} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Message Types */}
          <div>
            <h3 className="text-sm font-semibold mb-2 text-gray-400">Message Types</h3>
            <div className="space-y-3">
              {messageTypes.map(msg => (
                <div key={msg.name} className="bg-gray-900 rounded-lg p-3 border border-gray-800">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">{msg.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-cyan-900/50 border-cyan-700 text-cyan-300">
                      {msg.typeCodeRange}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {msg.fields.map(field => (
                      <span key={field} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-300">
                        {field}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Hardware */}
          <div>
            <h3 className="text-sm font-semibold mb-2 text-gray-400">Hardware</h3>
            <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-left text-gray-400">
                    <th className="py-2 pr-4">Component</th>
                    <th className="py-2 pr-4">Spec</th>
                    <th className="py-2 pr-4">Cost</th>
                    <th className="py-2">Shared</th>
                  </tr>
                </thead>
                <tbody>
                  {hardware.map(hw => (
                    <tr key={hw.name} className="border-b border-gray-800/50">
                      <td className="py-1.5 pr-4 font-medium">{hw.name}</td>
                      <td className="py-1.5 pr-4 text-gray-400">{hw.spec}</td>
                      <td className="py-1.5 pr-4 font-mono">{hw.cost}</td>
                      <td className="py-1.5">
                        {hw.sharedWithGroundlink && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-blue-900/50 border-blue-700 text-blue-300">
                            Shared with GROUNDLINK
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Software */}
          <div>
            <h3 className="text-sm font-semibold mb-2 text-gray-400">Software Stack</h3>
            <div className="space-y-3">
              {software.map(sw => (
                <div key={sw.name} className="bg-gray-900 rounded-lg p-3 border border-gray-800">
                  <h4 className="font-medium text-sm mb-1">{sw.name}</h4>
                  <p className="text-xs text-gray-400 mb-1">{sw.description}</p>
                  <div className="bg-gray-800 rounded p-1.5 font-mono text-[10px] text-gray-300 overflow-x-auto">
                    $ {sw.installCommand}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Integration */}
          <div>
            <h3 className="text-sm font-semibold mb-2 text-gray-400">GROUNDLINK Integration</h3>
            <div className="space-y-3">
              {integrationScenarios.map(scenario => (
                <div key={scenario.name} className="bg-gray-900 rounded-lg p-3 border border-gray-800">
                  <h4 className="font-medium text-sm mb-1">{scenario.name}</h4>
                  <p className="text-xs text-gray-400">{scenario.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Aircraft Log (historical) */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 mb-6 overflow-hidden">
        <button
          onClick={() => setShowLog(!showLog)}
          className="w-full px-4 py-3 border-b border-gray-800 flex items-center justify-between hover:bg-gray-800/30 transition-colors"
        >
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-gray-300">Aircraft Log</span>
            <span className="text-xs font-mono text-cyan-400">{logData.unique_aircraft} unique</span>
            <span className="text-xs font-mono text-gray-500">{logData.today} today</span>
            <span className="text-xs font-mono text-gray-500">{logData.total_sightings.toLocaleString()} sightings</span>
          </div>
          <span className="text-xs text-gray-500">{showLog ? 'Hide' : 'Show'}</span>
        </button>
        {showLog && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-3 py-2">ICAO</th>
                  <th className="px-3 py-2">Callsign</th>
                  <th className="px-3 py-2">First Seen</th>
                  <th className="px-3 py-2">Last Seen</th>
                  <th className="px-3 py-2">Msgs</th>
                  <th className="px-3 py-2">Last Position</th>
                  <th className="px-3 py-2">Alt</th>
                </tr>
              </thead>
              <tbody>
                {logData.aircraft.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-gray-600">
                      No aircraft logged yet — start the decoder to begin collecting
                    </td>
                  </tr>
                ) : (
                  logData.aircraft.map(ac => (
                    <tr key={ac.icao} className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer" onClick={() => setSelectedTrackIcao(ac.icao)}>
                      <td className="px-3 py-1.5 font-mono text-amber-400">{ac.icao}</td>
                      <td className="px-3 py-1.5 font-medium">
                        {ac.callsign || <span className="text-gray-600">---</span>}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-gray-400">
                        {new Date(ac.first_seen).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-gray-400">
                        {new Date(ac.last_seen).toLocaleString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="px-3 py-1.5 font-mono">{ac.total_msgs.toLocaleString()}</td>
                      <td className="px-3 py-1.5 font-mono text-gray-400">
                        {ac.last_pos
                          ? `${ac.last_pos.lat.toFixed(3)}, ${ac.last_pos.lon.toFixed(3)}`
                          : <span className="text-gray-600">---</span>
                        }
                      </td>
                      <td className="px-3 py-1.5 font-mono">
                        {ac.last_pos?.alt_ft != null
                          ? `${ac.last_pos.alt_ft.toLocaleString()} ft`
                          : <span className="text-gray-600">---</span>
                        }
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Flight Path Modal */}
      {selectedTrackIcao && (
        <FlightPathModal icao={selectedTrackIcao} onClose={() => setSelectedTrackIcao(null)} />
      )}
    </div>
  )
}
