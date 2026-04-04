/**
 * Fleet Bridge — TypeScript client for the MQTT-to-WebSocket bridge.
 *
 * Connects to the mqtt_bridge service to get aggregated multi-SDR data
 * from all fleet nodes. Used by the dashboard to display 4+ SDR feeds.
 */

export interface FleetSdrStatus {
  device_index: number
  mode: string
  label: string
  running: boolean
  pid: number | null
  uptime_s: number
  log: string[]
}

export interface FleetNodeStatus {
  node_id: string
  timestamp: string
  mqtt_connected: boolean
  sdrs: Record<string, FleetSdrStatus>
}

export interface FleetOverview {
  nodes: Record<string, {
    status: FleetNodeStatus
    sdr_count: number
    last_update: number
  }>
  total_aircraft: number
  total_detections: number
  timestamp: string
}

export interface FleetAircraft {
  icao: string
  callsign: string | null
  lat: number | null
  lon: number | null
  alt_ft: number | null
  gs_kt: number | null
  hdg: number | null
  vr_fpm: number | null
  on_ground: boolean
  msgs: number
  _source_sdr: number
  _source_node: string
}

export interface FleetSdrDataEvent {
  type: 'sdr_data'
  node_id: string
  sdr_index: number
  mode: string
  data_type: string
  data: Record<string, unknown>
}

export interface FleetStatusEvent {
  type: 'fleet_status'
  node_id: string
  [key: string]: unknown
}

export type FleetEvent = FleetSdrDataEvent | FleetStatusEvent | {
  type: 'init'
  fleet: FleetOverview
  aircraft: FleetAircraft[]
}

const FLEET_API_URL = process.env.FLEET_API_URL || 'http://localhost:8791'

/** Fetch fleet overview from the MQTT bridge HTTP API. */
export async function getFleetOverview(): Promise<FleetOverview> {
  const res = await fetch(`${FLEET_API_URL}/api/fleet`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(3000),
  })
  return res.json()
}

/** Fetch merged aircraft from all ADS-B SDRs. */
export async function getMergedAircraft(): Promise<{ aircraft: FleetAircraft[]; count: number }> {
  const res = await fetch(`${FLEET_API_URL}/api/aircraft`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(3000),
  })
  return res.json()
}

/** Fetch recent scanner detections across all SDRs. */
export async function getDetections(limit = 100): Promise<{ detections: unknown[]; count: number }> {
  const res = await fetch(`${FLEET_API_URL}/api/detections?limit=${limit}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(3000),
  })
  return res.json()
}

/** Fetch all node statuses. */
export async function getNodes(): Promise<Record<string, FleetNodeStatus>> {
  const res = await fetch(`${FLEET_API_URL}/api/nodes`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(3000),
  })
  return res.json()
}
