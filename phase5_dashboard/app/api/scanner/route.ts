import { NextRequest, NextResponse } from 'next/server'
import { fetchScannerStatus, startScanner, stopScanner } from '@/lib/scanner-bridge'

export async function GET() {
  try {
    const status = await fetchScannerStatus()
    return NextResponse.json(status)
  } catch {
    return NextResponse.json(
      { running: false, scan_id: null, current_freq_hz: 0, total_detections: 0, error: 'Scanner service not available' },
      { status: 200 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const action = body.action as string

    if (action === 'start') {
      const result = await startScanner(body.config)
      return NextResponse.json(result)
    } else if (action === 'stop') {
      const result = await stopScanner()
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { error: `Scanner control failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    )
  }
}
