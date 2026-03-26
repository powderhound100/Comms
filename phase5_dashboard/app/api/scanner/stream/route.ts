/**
 * SSE bridge: connects to the scanner WebSocket server-side and
 * re-emits events as Server-Sent Events so remote browsers can
 * receive live data through the Cloudflare tunnel.
 *
 * Uses Node 22 built-in WebSocket — no extra packages needed.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SCANNER_WS_URL = process.env.SCANNER_WS_URL || 'ws://localhost:8765'

export async function GET(request: Request) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      let ws: WebSocket | null = null

      request.signal.addEventListener('abort', () => {
        ws?.close()
        try { controller.close() } catch { /* already closed */ }
      })

      try {
        ws = new WebSocket(SCANNER_WS_URL)

        ws.onopen = () => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`))
        }

        ws.onmessage = (event) => {
          try {
            const msg = typeof event.data === 'string' ? event.data : String(event.data)
            controller.enqueue(encoder.encode(`data: ${msg}\n\n`))
          } catch { /* skip */ }
        }

        ws.onclose = () => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'disconnected' })}\n\n`))
            controller.close()
          } catch { /* already closed */ }
        }

        ws.onerror = () => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error' })}\n\n`))
            controller.close()
          } catch { /* already closed */ }
        }
      } catch {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Scanner unavailable' })}\n\n`))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
