/**
 * Radio audio SSE stream — connects to the Python radio backend
 * and streams base64-encoded PCM audio chunks to the browser.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RADIO_WS_URL = process.env.RADIO_WS_URL || 'ws://localhost:8770'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const freq = url.searchParams.get('freq') || '94900000'
  const mode = url.searchParams.get('mode') || 'wfm'

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      let ws: WebSocket | null = null

      request.signal.addEventListener('abort', () => {
        ws?.close()
        try { controller.close() } catch { /* */ }
      })

      try {
        ws = new WebSocket(`${RADIO_WS_URL}?freq=${freq}&mode=${mode}`)

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
          } catch { /* */ }
        }

        ws.onerror = () => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error' })}\n\n`))
            controller.close()
          } catch { /* */ }
        }
      } catch {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error' })}\n\n`))
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
