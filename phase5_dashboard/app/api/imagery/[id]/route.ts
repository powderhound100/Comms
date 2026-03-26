// GET /api/imagery/[id] — Get single image metadata by ID
import { NextRequest, NextResponse } from 'next/server'
import { getImage } from '@/lib/imagery-store'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const image = await getImage(id)
    if (!image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 })
    }
    return NextResponse.json(image)
  } catch {
    return NextResponse.json({ error: 'Failed to get image' }, { status: 500 })
  }
}
