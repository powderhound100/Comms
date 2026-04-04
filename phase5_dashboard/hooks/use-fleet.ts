'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type {
  FleetOverview,
  FleetAircraft,
  FleetSdrStatus,
  FleetEvent,
} from '@/lib/fleet-bridge'

export interface FleetState {
  connected: boolean
  overview: FleetOverview | null
  aircraft: FleetAircraft[]
  /** Per-SDR latest data keyed by "nodeId:deviceIndex" */
  sdrData: Record<string, {
    mode: string
    dataType: string
    data: Record<string, unknown>
    updatedAt: number
  }>
  /** Per-SDR status keyed by "nodeId:deviceIndex" */
  sdrStatuses: Record<string, FleetSdrStatus>
}

const EMPTY_OVERVIEW: FleetOverview = {
  nodes: {},
  total_aircraft: 0,
  total_detections: 0,
  timestamp: '',
}

/**
 * React hook for fleet-wide SDR state via WebSocket.
 *
 * Connects to the MQTT bridge WebSocket and maintains
 * real-time state for all SDR nodes and devices.
 */
export function useFleet() {
  const [state, setState] = useState<FleetState>({
    connected: false,
    overview: null,
    aircraft: [],
    sdrData: {},
    sdrStatuses: {},
  })

  const wsRef = useRef<WebSocket | null>(null)
  const sdrDataRef = useRef<FleetState['sdrData']>({})
  const aircraftRef = useRef<Map<string, FleetAircraft>>(new Map())

  useEffect(() => {
    const isLocal = typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    const wsUrl = isLocal
      ? 'ws://localhost:8790/ws'
      : 'wss://fleet.powderhound420.com/ws'

    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    function connect() {
      ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setState(prev => ({ ...prev, connected: true }))
      }

      ws.onclose = () => {
        setState(prev => ({ ...prev, connected: false }))
        reconnectTimer = setTimeout(connect, 3000)
      }

      ws.onerror = () => { /* triggers onclose */ }

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        try {
          const msg: FleetEvent = JSON.parse(event.data)

          if (msg.type === 'init') {
            // Initial state dump
            const acMap = new Map<string, FleetAircraft>()
            for (const ac of msg.aircraft) {
              acMap.set(ac.icao, ac)
            }
            aircraftRef.current = acMap

            setState(prev => ({
              ...prev,
              overview: msg.fleet,
              aircraft: msg.aircraft,
            }))
          } else if (msg.type === 'fleet_status') {
            setState(prev => ({
              ...prev,
              overview: {
                ...(prev.overview || EMPTY_OVERVIEW),
                timestamp: (msg as Record<string, unknown>).timestamp as string || '',
              },
            }))
          } else if (msg.type === 'sdr_data') {
            const key = `${msg.node_id}:${msg.sdr_index}`
            sdrDataRef.current = {
              ...sdrDataRef.current,
              [key]: {
                mode: msg.mode,
                dataType: msg.data_type,
                data: msg.data,
                updatedAt: Date.now(),
              },
            }

            // Merge aircraft from ADS-B data
            if (msg.mode === 'adsb' && msg.data_type === 'aircraft') {
              const acList = (msg.data.aircraft || []) as FleetAircraft[]
              for (const ac of acList) {
                if (ac.icao) {
                  ac._source_sdr = msg.sdr_index
                  ac._source_node = msg.node_id
                  aircraftRef.current.set(ac.icao.toUpperCase(), ac)
                }
              }
            }

            setState(prev => ({
              ...prev,
              sdrData: { ...sdrDataRef.current },
              aircraft: Array.from(aircraftRef.current.values()),
            }))
          }
        } catch { /* skip malformed */ }
      }
    }

    connect()

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) ws.close()
      wsRef.current = null
    }
  }, [])

  /** Get all SDR statuses as a flat array. */
  const getSdrList = useCallback((): (FleetSdrStatus & { nodeId: string })[] => {
    const result: (FleetSdrStatus & { nodeId: string })[] = []
    if (!state.overview) return result

    for (const [nodeId, nodeData] of Object.entries(state.overview.nodes)) {
      const status = nodeData.status
      if (status?.sdrs) {
        for (const sdr of Object.values(status.sdrs)) {
          result.push({ ...sdr, nodeId })
        }
      }
    }
    return result
  }, [state.overview])

  return {
    ...state,
    getSdrList,
  }
}
