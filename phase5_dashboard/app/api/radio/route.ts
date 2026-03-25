import { NextRequest, NextResponse } from 'next/server'

const SCANNER_API = process.env.SCANNER_API_URL || 'http://localhost:8766'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const res = await fetch(`${SCANNER_API}/api/radio/tune`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Radio backend unavailable' }, { status: 503 })
  }
}

export async function GET() {
  try {
    const res = await fetch(`${SCANNER_API}/api/radio/status`, { cache: 'no-store' })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ tuned: false, freq_hz: 0, mode: 'wfm' })
  }
}
