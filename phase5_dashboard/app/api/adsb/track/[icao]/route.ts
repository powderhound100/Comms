import { NextResponse } from 'next/server'

const AGENT_URL = process.env.SDR_AGENT_URL || 'http://localhost:8780'

/** Proxy to host-side SDR agent aircraft track endpoint. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ icao: string }> },
) {
  const { icao } = await params
  try {
    const res = await fetch(`${AGENT_URL}/api/adsb/track/${encodeURIComponent(icao)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`Agent: ${res.status}`)
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ icao, aircraft: null, sightings: [], total_points: 0 })
  }
}
