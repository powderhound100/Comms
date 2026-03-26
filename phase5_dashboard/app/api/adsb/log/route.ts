import { NextResponse } from 'next/server'

const AGENT_URL = process.env.SDR_AGENT_URL || 'http://localhost:8780'

/** Proxy to host-side SDR agent aircraft log. */
export async function GET() {
  try {
    const res = await fetch(`${AGENT_URL}/api/adsb/log`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) throw new Error(`Agent: ${res.status}`)
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ unique_aircraft: 0, today: 0, total_sightings: 0, aircraft: [] })
  }
}
