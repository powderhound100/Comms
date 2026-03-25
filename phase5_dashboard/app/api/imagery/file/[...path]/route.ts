// GET /api/imagery/file/[...path] — Serve decoded image files from output directory
import { NextRequest, NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import path from 'path'

// Base directory for decoded satellite imagery
const IMAGERY_BASE = path.join(process.cwd(), 'public', 'sat-images')

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.gif': 'image/gif',
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await params
  const filePath = path.join(IMAGERY_BASE, ...pathSegments)

  // Security: prevent directory traversal
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(path.resolve(IMAGERY_BASE))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const stats = await stat(resolved)
    if (!stats.isFile()) {
      return NextResponse.json({ error: 'Not a file' }, { status: 404 })
    }

    const ext = path.extname(resolved).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    const data = await readFile(resolved)
    return new NextResponse(data, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}
