import { NextRequest, NextResponse } from 'next/server'
import { fetchDetections } from '@/lib/scanner-bridge'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const params: Record<string, string | number> = {}

    const scanId = searchParams.get('scan_id')
    if (scanId) params.scan_id = scanId

    const minFreq = searchParams.get('min_freq')
    if (minFreq) params.min_freq = parseFloat(minFreq)

    const maxFreq = searchParams.get('max_freq')
    if (maxFreq) params.max_freq = parseFloat(maxFreq)

    const modulation = searchParams.get('modulation')
    if (modulation) params.modulation = modulation

    params.limit = parseInt(searchParams.get('limit') || '100')
    params.offset = parseInt(searchParams.get('offset') || '0')

    const result = await fetchDetections(params)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json(
      { detections: [], count: 0, error: 'Scanner service not available' },
      { status: 200 }
    )
  }
}
