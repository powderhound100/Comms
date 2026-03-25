// GET /api/imagery — List decoded satellite images with optional filters
import { NextRequest, NextResponse } from 'next/server'
import { listImages } from '@/lib/imagery-store'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const satellite = searchParams.get('satellite') || undefined
  const limit = parseInt(searchParams.get('limit') || '50', 10)
  const offset = parseInt(searchParams.get('offset') || '0', 10)

  try {
    const result = await listImages({ satellite, limit, offset })
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Failed to list images' }, { status: 500 })
  }
}
