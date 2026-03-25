/**
 * HTTP bridge to the Phase 7 Python scanner service.
 * The scanner runs on localhost:8766 with a simple REST API.
 */

const SCANNER_API = process.env.SCANNER_API_URL || 'http://localhost:8766'

export async function fetchScannerStatus() {
  const res = await fetch(`${SCANNER_API}/api/status`, {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Scanner API error: ${res.status}`)
  return res.json()
}

export async function startScanner(config?: Record<string, unknown>) {
  const res = await fetch(`${SCANNER_API}/api/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: config ? JSON.stringify(config) : '{}',
  })
  if (!res.ok) throw new Error(`Scanner start error: ${res.status}`)
  return res.json()
}

export async function stopScanner() {
  const res = await fetch(`${SCANNER_API}/api/stop`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`Scanner stop error: ${res.status}`)
  return res.json()
}

export async function fetchDetections(params: {
  scan_id?: string
  min_freq?: number
  max_freq?: number
  modulation?: string
  limit?: number
  offset?: number
}) {
  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined) searchParams.set(key, String(val))
  })

  const res = await fetch(`${SCANNER_API}/api/detections?${searchParams}`, {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Detections query error: ${res.status}`)
  return res.json()
}

export async function fetchScans() {
  const res = await fetch(`${SCANNER_API}/api/scans`, {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Scans query error: ${res.status}`)
  return res.json()
}

/** WebSocket URL for real-time scanner data */
export function getScannerWsUrl(): string {
  return process.env.SCANNER_WS_URL || 'ws://localhost:8765'
}
