/**
 * Unified SDR process manager — HTTP client to the host-side SDR agent.
 *
 * In Docker the dashboard can't spawn processes on the host, so we
 * delegate to sdr_agent.py (running on the Windows host with RTL-SDR
 * hardware) via HTTP.
 *
 * When running locally (npm run dev) the agent is at localhost:8780.
 * In Docker it's at host.docker.internal:8780.
 */

export type SdrMode = 'radio' | 'scanner' | 'adsb'

export interface RadioConfig {
  port?: number
  freq?: number       // MHz, e.g. 94.9
  mode?: 'wfm' | 'nfm' | 'am'
}

export interface ScannerConfig {
  mock?: boolean
  mode?: 'sweep' | 'watch' | 'band_list'
  start_freq?: number  // MHz
  stop_freq?: number   // MHz
  watch_freq?: number  // MHz
}

export interface AdsbConfig {
  port?: number
  gain?: number
  device?: number
  test?: boolean
}

export type ModeConfig = RadioConfig | ScannerConfig | AdsbConfig

export interface SdrStatus {
  active_mode: SdrMode | null
  pid: number | null
  uptime_s: number
  log: string[]
}

const AGENT_URL = process.env.SDR_AGENT_URL || 'http://localhost:8780'

const EMPTY_STATUS: SdrStatus = {
  active_mode: null,
  pid: null,
  uptime_s: 0,
  log: [],
}

class SdrManager {
  /** Get current status from the host agent. */
  async status(): Promise<SdrStatus> {
    try {
      const res = await fetch(`${AGENT_URL}/api/sdr`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) return { ...EMPTY_STATUS, log: [`Agent error: ${res.status}`] }
      return await res.json()
    } catch {
      return { ...EMPTY_STATUS, log: ['SDR agent not reachable'] }
    }
  }

  /** Start a mode (agent auto-stops current). */
  async start(newMode: SdrMode, config: ModeConfig = {}): Promise<{ ok: boolean; message: string; pid?: number }> {
    try {
      const res = await fetch(`${AGENT_URL}/api/sdr/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode, config }),
        signal: AbortSignal.timeout(10000),
      })
      return await res.json()
    } catch (e) {
      return { ok: false, message: `Agent unreachable: ${e instanceof Error ? e.message : 'Unknown'}` }
    }
  }

  /** Stop the active mode. */
  async stop(): Promise<{ ok: boolean; stopped: SdrMode | null }> {
    try {
      const res = await fetch(`${AGENT_URL}/api/sdr/stop`, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
      })
      return await res.json()
    } catch {
      return { ok: false, stopped: null }
    }
  }
}

// Module-level singleton
const sdrManager = new SdrManager()
export default sdrManager
