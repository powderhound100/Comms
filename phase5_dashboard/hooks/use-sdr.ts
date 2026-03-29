'use client'

import { useState, useEffect, useCallback } from 'react'

export type SdrMode = 'radio' | 'scanner' | 'adsb' | 'adsb_dual'

export interface SdrStatus {
  active_mode: SdrMode | null
  pid: number | null
  uptime_s: number
  log: string[]
}

/** Pi slot status returned from /api/pi/status */
interface PiSlotStatus {
  mode: string | null
  running: boolean
  pid: number | null
  uptime_s: number | null
}

const EMPTY: SdrStatus = { active_mode: null, pid: null, uptime_s: 0, log: [] }

// Modes that run on Pi slot 2 (independent of adsb_dual on Windows)
const PI_SLOT2_MODES: Set<SdrMode> = new Set(['radio', 'scanner'])

/**
 * Shared hook for SDR mode control.
 * Polls /api/sdr and provides start/stop for a specific mode.
 *
 * When adsb_dual is active on Windows, radio/scanner run on Pi slot 2
 * independently — no conflict with ADS-B.
 */
export function useSdr(myMode: SdrMode) {
  const [status, setStatus] = useState<SdrStatus>(EMPTY)
  const [piSlot2, setPiSlot2] = useState<PiSlotStatus | null>(null)
  const [loading, setLoading] = useState(false)

  const adsbDualActive = status.active_mode === 'adsb_dual'
  const isPiMode = PI_SLOT2_MODES.has(myMode)

  // When adsb_dual + pi mode: check Pi slot 2 for radio/scanner status
  const isMyMode = isPiMode && adsbDualActive
    ? piSlot2?.running === true && piSlot2?.mode === myMode
    : status.active_mode === myMode

  // No conflict when adsb_dual is active and we're a Pi mode
  const isOtherMode = isPiMode && adsbDualActive
    ? false  // ADS-B runs on different slots, no conflict
    : status.active_mode !== null && status.active_mode !== myMode

  // Poll Windows sdr_agent status
  useEffect(() => {
    let alive = true
    async function poll() {
      try {
        const res = await fetch('/api/sdr')
        if (alive) setStatus(await res.json())
      } catch { /* offline */ }
    }
    poll()
    const timer = setInterval(poll, 3000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  // Poll Pi slot 2 status when relevant
  useEffect(() => {
    if (!isPiMode) return
    let alive = true
    async function poll() {
      try {
        const res = await fetch('/api/pi/status')
        if (!alive) return
        const data = await res.json()
        if (data.error) return
        // Slots can be object or array
        const slots = data.slots
        const slot2 = slots?.[2] ?? slots?.['2'] ?? null
        if (slot2) setPiSlot2(slot2)
      } catch { /* pi offline */ }
    }
    poll()
    const timer = setInterval(poll, 3000)
    return () => { alive = false; clearInterval(timer) }
  }, [isPiMode])

  // Start this mode
  const start = useCallback(async (config: Record<string, unknown> = {}) => {
    setLoading(true)
    try {
      if (isPiMode && adsbDualActive) {
        // Start on Pi slot 2 — don't touch adsb_dual on Windows
        const piMode = myMode === 'radio' ? 'radio' : 'scanner'
        const res = await fetch('/api/pi/sdr/2/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: piMode, config }),
        })
        const data = await res.json()
        if (data.ok) {
          setPiSlot2({ mode: piMode, running: true, pid: data.pid ?? null, uptime_s: 0 })
        }
        return data.ok as boolean
      } else {
        // Normal Windows sdr_agent start
        const res = await fetch('/api/sdr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start', mode: myMode, config }),
        })
        const data = await res.json()
        setStatus(data)
        return data.ok as boolean
      }
    } catch {
      return false
    } finally {
      setLoading(false)
    }
  }, [myMode, isPiMode, adsbDualActive])

  // Stop current mode
  const stop = useCallback(async () => {
    setLoading(true)
    try {
      if (isPiMode && adsbDualActive) {
        // Stop Pi slot 2
        const res = await fetch('/api/pi/sdr/2/stop', { method: 'POST' })
        const data = await res.json()
        if (data.ok) {
          setPiSlot2({ mode: null, running: false, pid: null, uptime_s: null })
        }
        return data.ok as boolean
      } else {
        const res = await fetch('/api/sdr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'stop' }),
        })
        const data = await res.json()
        setStatus(data)
        return data.ok as boolean
      }
    } catch {
      return false
    } finally {
      setLoading(false)
    }
  }, [isPiMode, adsbDualActive])

  return { status, loading, isMyMode, isOtherMode, start, stop, piSlot2, adsbDualActive }
}
