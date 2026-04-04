import { NextRequest, NextResponse } from 'next/server'

/**
 * Fleet API proxy — forwards requests to the MQTT bridge HTTP API.
 *
 * GET  /api/fleet          → fleet overview
 * GET  /api/fleet?q=aircraft → merged aircraft
 * GET  /api/fleet?q=detections → recent detections
 */

const FLEET_API_URL = process.env.FLEET_API_URL || 'http://localhost:8791'

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')

  let endpoint = '/api/fleet'
  if (query === 'aircraft') endpoint = '/api/aircraft'
  else if (query === 'detections') endpoint = '/api/detections'
  else if (query === 'nodes') endpoint = '/api/nodes'

  try {
    const res = await fetch(`${FLEET_API_URL}${endpoint}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: `Fleet bridge returned ${res.status}` },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json(
      { error: `Fleet bridge unreachable: ${error instanceof Error ? error.message : 'Unknown'}` },
      { status: 503 }
    )
  }
}
