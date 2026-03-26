'use client'

import { useState, useEffect, useCallback } from 'react'

export type SdrMode = 'radio' | 'scanner' | 'adsb'

export interface SdrStatus {
  active_mode: SdrMode | null
  pid: number | null
  uptime_s: number
  log: string[]
}

const EMPTY: SdrStatus = { active_mode: null, pid: null, uptime_s: 0, log: [] }

/**
 * Shared hook for SDR mode control.
 * Polls /api/sdr and provides start/stop for a specific mode.
 */
export function useSdr(myMode: SdrMode) {
  const [status, setStatus] = useState<SdrStatus>(EMPTY)
  const [loading, setLoading] = useState(false)

  const isMyMode = status.active_mode === myMode
  const isOtherMode = status.active_mode !== null && status.active_mode !== myMode

  // Poll status
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

  // Start this mode (auto-stops any running mode)
  const start = useCallback(async (config: Record<string, unknown> = {}) => {
    setLoading(true)
    try {
      const res = await fetch('/api/sdr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', mode: myMode, config }),
      })
      const data = await res.json()
      setStatus(data)
      return data.ok as boolean
    } catch {
      return false
    } finally {
      setLoading(false)
    }
  }, [myMode])

  // Stop current mode
  const stop = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sdr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      })
      const data = await res.json()
      setStatus(data)
      return data.ok as boolean
    } catch {
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  return { status, loading, isMyMode, isOtherMode, start, stop }
}
