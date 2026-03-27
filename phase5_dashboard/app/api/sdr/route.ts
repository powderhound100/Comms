import { NextRequest, NextResponse } from 'next/server'
import sdrManager from '@/lib/sdr-manager'
import type { SdrMode, ModeConfig } from '@/lib/sdr-manager'

/**
 * Unified SDR control — proxies to the host-side sdr_agent.py.
 *
 * GET  /api/sdr  → { active_mode, pid, uptime_s, log }
 * POST /api/sdr  → { action: "start", mode, config } | { action: "stop" }
 */

const VALID_MODES: SdrMode[] = ['radio', 'scanner', 'adsb', 'adsb_dual']

export async function GET() {
  return NextResponse.json(await sdrManager.status())
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const action = body.action as string

    if (action === 'start') {
      const mode = body.mode as SdrMode
      if (!VALID_MODES.includes(mode)) {
        return NextResponse.json(
          { ok: false, error: `Invalid mode: ${mode}. Use: ${VALID_MODES.join(', ')}` },
          { status: 400 }
        )
      }

      const config: ModeConfig = body.config ?? {}
      const result = await sdrManager.start(mode, config)

      return NextResponse.json({
        ...result,
        ...(await sdrManager.status()),
      }, { status: result.ok ? 200 : 500 })

    } else if (action === 'stop') {
      const result = await sdrManager.stop()
      return NextResponse.json({
        ...result,
        ...(await sdrManager.status()),
      })

    } else {
      return NextResponse.json(
        { ok: false, error: 'Invalid action. Use: start, stop' },
        { status: 400 }
      )
    }
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: `SDR control failed: ${error instanceof Error ? error.message : 'Unknown'}` },
      { status: 500 }
    )
  }
}
