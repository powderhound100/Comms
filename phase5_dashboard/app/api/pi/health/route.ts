import { NextResponse } from 'next/server'

const AGENT_URL = process.env.SDR_AGENT_URL || 'http://localhost:8780'

export async function GET() {
  try {
    const res = await fetch(`${AGENT_URL}/api/pi/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      return NextResponse.json({ error: `Agent error: ${res.status}`, ok: false }, { status: 502 })
    }
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ error: 'Pi not reachable', ok: false }, { status: 502 })
  }
}
