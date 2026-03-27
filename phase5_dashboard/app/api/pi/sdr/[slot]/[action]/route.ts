import { NextRequest, NextResponse } from 'next/server'

const AGENT_URL = process.env.SDR_AGENT_URL || 'http://localhost:8780'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slot: string; action: string }> }
) {
  const { slot, action } = await params
  try {
    let body = {}
    try { body = await request.json() } catch { /* no body */ }

    const res = await fetch(`${AGENT_URL}/api/pi/sdr/${slot}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Pi not reachable', ok: false }, { status: 502 })
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slot: string; action: string }> }
) {
  const { slot, action } = await params
  try {
    const res = await fetch(`${AGENT_URL}/api/pi/sdr/${slot}/${action}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Pi not reachable' }, { status: 502 })
  }
}
