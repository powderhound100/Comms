import { NextRequest, NextResponse } from 'next/server'
import sdrManager from '@/lib/sdr-manager'

/**
 * Legacy ADS-B endpoint — delegates to the unified SDR manager.
 * Kept for backward compatibility; prefer /api/sdr directly.
 */

export async function GET() {
  const s = await sdrManager.status()
  return NextResponse.json({
    running: s.active_mode === 'adsb',
    pid: s.active_mode === 'adsb' ? s.pid : null,
    uptime_s: s.active_mode === 'adsb' ? s.uptime_s : 0,
    log: s.log,
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const action = body.action as string

    if (action === 'start') {
      const result = await sdrManager.start('adsb', {
        gain: body.gain ?? 496,
        device: body.device ?? 0,
        port: body.port ?? 8771,
        test: body.test ?? false,
      })
      return NextResponse.json(result, { status: result.ok ? 200 : 500 })
    } else if (action === 'stop') {
      const result = await sdrManager.stop()
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { error: `ADS-B control failed: ${error instanceof Error ? error.message : 'Unknown'}` },
      { status: 500 }
    )
  }
}
