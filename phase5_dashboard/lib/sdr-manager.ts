/**
 * Unified SDR process manager.
 *
 * Only one SDR mode can run at a time (shared RTL-SDR hardware).
 * This singleton tracks the active mode and manages subprocess lifecycle
 * for radio, scanner, and ADS-B backends.
 */

import { spawn, ChildProcess } from 'child_process'
import path from 'path'

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

const PHASE7_DIR = path.resolve(process.cwd(), '..', 'phase7_scan_detect')
const RTLSDR_DIR = 'D:\\tools\\rtl-sdr\\x64'
const MAX_LOG_LINES = 60

class SdrManager {
  private proc: ChildProcess | null = null
  private mode: SdrMode | null = null
  private startedAt: number | null = null
  private log: string[] = []

  private pushLog(line: string) {
    this.log.push(line)
    if (this.log.length > MAX_LOG_LINES) this.log.shift()
  }

  private isRunning(): boolean {
    return this.proc !== null && this.proc.exitCode === null && !this.proc.killed
  }

  private buildEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env }
    if (env.PATH && !env.PATH.includes(RTLSDR_DIR)) {
      env.PATH = RTLSDR_DIR + ';' + env.PATH
    }
    return env
  }

  /** Kill the active process tree. */
  async stop(): Promise<{ ok: boolean; stopped: SdrMode | null }> {
    const wasMode = this.mode

    if (!this.isRunning()) {
      this.proc = null
      this.mode = null
      this.startedAt = null
      return { ok: true, stopped: wasMode }
    }

    const pid = this.proc!.pid!
    this.pushLog(`Stopping ${wasMode} (PID ${pid})...`)

    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        this.proc!.kill('SIGTERM')
      }
    } catch { /* ignore */ }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try { this.proc?.kill('SIGKILL') } catch { /* ignore */ }
        resolve()
      }, 3000)
      if (this.proc) {
        this.proc.on('exit', () => { clearTimeout(timeout); resolve() })
      } else {
        clearTimeout(timeout)
        resolve()
      }
    })

    this.pushLog(`${wasMode} stopped.`)
    this.proc = null
    this.mode = null
    this.startedAt = null

    return { ok: true, stopped: wasMode }
  }

  /** Start a mode, stopping the current one first if different. */
  async start(newMode: SdrMode, config: ModeConfig = {}): Promise<{ ok: boolean; message: string; pid?: number }> {
    // Stop current if running
    if (this.isRunning()) {
      if (this.mode === newMode) {
        return { ok: true, message: `${newMode} already running`, pid: this.proc!.pid! }
      }
      this.pushLog(`Switching from ${this.mode} to ${newMode}...`)
      await this.stop()
      // Small delay to release RTL-SDR device
      await new Promise(r => setTimeout(r, 800))
    }

    this.log = []
    const env = this.buildEnv()
    let cmd: string
    let args: string[]

    switch (newMode) {
      case 'radio': {
        const c = config as RadioConfig
        cmd = 'python'
        args = [
          path.join(PHASE7_DIR, 'radio_server.py'),
          '--port', String(c.port ?? 8770),
          '--freq', String(c.freq ?? 94.9),
          '--mode', c.mode ?? 'wfm',
        ]
        break
      }
      case 'scanner': {
        const c = config as ScannerConfig
        cmd = 'python'
        args = [path.join(PHASE7_DIR, 'scanner.py')]
        if (c.mock) args.push('--mock')
        if (c.mode) args.push('--mode', c.mode)
        if (c.start_freq) args.push('--start-freq', String(c.start_freq))
        if (c.stop_freq) args.push('--stop-freq', String(c.stop_freq))
        if (c.watch_freq) args.push('--watch-freq', String(c.watch_freq))
        break
      }
      case 'adsb': {
        const c = config as AdsbConfig
        cmd = 'python'
        args = [
          path.join(PHASE7_DIR, 'adsb_server.py'),
          '--port', String(c.port ?? 8771),
          '--gain', String(c.gain ?? 496),
          '--device', String(c.device ?? 0),
        ]
        if (c.test) args.push('--test')
        break
      }
    }

    this.pushLog(`Starting ${newMode}: ${cmd} ${args.join(' ')}`)

    this.proc = spawn(cmd, args, {
      cwd: PHASE7_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    this.mode = newMode
    this.startedAt = Date.now()

    this.proc.stdout?.on('data', (chunk: Buffer) => {
      chunk.toString().split('\n').filter(Boolean).forEach(l => this.pushLog(`[out] ${l}`))
    })
    this.proc.stderr?.on('data', (chunk: Buffer) => {
      chunk.toString().split('\n').filter(Boolean).forEach(l => this.pushLog(`[log] ${l}`))
    })
    this.proc.on('exit', (code) => {
      this.pushLog(`${newMode} exited (code ${code})`)
      this.proc = null
      this.mode = null
      this.startedAt = null
    })

    // Wait a moment to catch immediate failures
    await new Promise(r => setTimeout(r, 600))

    if (this.isRunning()) {
      return { ok: true, message: `${newMode} started`, pid: this.proc!.pid! }
    } else {
      const failMode = this.mode
      this.mode = null
      this.startedAt = null
      return { ok: false, message: `${failMode ?? newMode} exited immediately — check log` }
    }
  }

  /** Current status. */
  status(): SdrStatus {
    return {
      active_mode: this.isRunning() ? this.mode : null,
      pid: this.isRunning() ? this.proc!.pid! : null,
      uptime_s: this.isRunning() && this.startedAt
        ? Math.round((Date.now() - this.startedAt) / 1000)
        : 0,
      log: this.log.slice(-30),
    }
  }
}

// Module-level singleton — survives across API requests in the same Node process
const sdrManager = new SdrManager()
export default sdrManager
