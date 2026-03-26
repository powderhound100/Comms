import { NextRequest, NextResponse } from 'next/server'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'

/**
 * Manages the adsb_server.py subprocess (which spawns groundlink_adsb.exe).
 *
 * GET  /api/adsb         → { running, pid, uptime_s }
 * POST /api/adsb  start  → spawn adsb_server.py
 * POST /api/adsb  stop   → kill the process
 */

const PHASE7_DIR = path.resolve(process.cwd(), '..', 'phase7_scan_detect')
const ADSB_SCRIPT = path.join(PHASE7_DIR, 'adsb_server.py')
const RTLSDR_DIR = 'D:\\tools\\rtl-sdr\\x64'

let adsbProc: ChildProcess | null = null
let startedAt: number | null = null
let lastLog: string[] = []
const MAX_LOG_LINES = 40

function isRunning(): boolean {
  return adsbProc !== null && adsbProc.exitCode === null && !adsbProc.killed
}

function pushLog(line: string) {
  lastLog.push(line)
  if (lastLog.length > MAX_LOG_LINES) lastLog.shift()
}

export async function GET() {
  return NextResponse.json({
    running: isRunning(),
    pid: isRunning() ? adsbProc!.pid : null,
    uptime_s: isRunning() && startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0,
    log: lastLog.slice(-20),
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const action = body.action as string

    if (action === 'start') {
      if (isRunning()) {
        return NextResponse.json({ ok: true, message: 'Already running', pid: adsbProc!.pid })
      }

      const gain = body.gain ?? 496
      const device = body.device ?? 0
      const port = body.port ?? 8771
      const test = body.test ?? false

      const args = [
        ADSB_SCRIPT,
        '--port', String(port),
        '--gain', String(gain),
        '--device', String(device),
      ]
      if (test) args.push('--test')

      // Ensure rtlsdr.dll is on PATH
      const env = { ...process.env }
      if (env.PATH && !env.PATH.includes(RTLSDR_DIR)) {
        env.PATH = RTLSDR_DIR + ';' + env.PATH
      }

      lastLog = []
      pushLog(`Starting: python ${args.join(' ')}`)

      adsbProc = spawn('python', args, {
        cwd: PHASE7_DIR,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })

      startedAt = Date.now()

      adsbProc.stdout?.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(Boolean)
        lines.forEach(l => pushLog(`[out] ${l}`))
      })

      adsbProc.stderr?.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(Boolean)
        lines.forEach(l => pushLog(`[log] ${l}`))
      })

      adsbProc.on('exit', (code) => {
        pushLog(`Process exited with code ${code}`)
        adsbProc = null
        startedAt = null
      })

      // Give it a moment to fail or start
      await new Promise(r => setTimeout(r, 500))

      if (isRunning()) {
        return NextResponse.json({ ok: true, message: 'Started', pid: adsbProc!.pid })
      } else {
        return NextResponse.json(
          { ok: false, message: 'Process exited immediately', log: lastLog },
          { status: 500 }
        )
      }

    } else if (action === 'stop') {
      if (!isRunning()) {
        return NextResponse.json({ ok: true, message: 'Not running' })
      }

      const pid = adsbProc!.pid
      pushLog(`Stopping process (PID ${pid})...`)

      // On Windows, tree-kill the process group
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
        } else {
          adsbProc!.kill('SIGTERM')
        }
      } catch { /* ignore */ }

      // Wait for exit
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          try { adsbProc?.kill('SIGKILL') } catch { /* ignore */ }
          resolve()
        }, 3000)
        adsbProc?.on('exit', () => { clearTimeout(timeout); resolve() })
      })

      adsbProc = null
      startedAt = null

      return NextResponse.json({ ok: true, message: 'Stopped', pid })

    } else {
      return NextResponse.json({ error: 'Invalid action (use start or stop)' }, { status: 400 })
    }
  } catch (error) {
    return NextResponse.json(
      { error: `ADS-B control failed: ${error instanceof Error ? error.message : 'Unknown'}` },
      { status: 500 }
    )
  }
}
