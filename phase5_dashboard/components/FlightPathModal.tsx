'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { FlightTrack } from '@/data/scan-detect'

interface FlightPathModalProps {
  icao: string
  onClose: () => void
}

export default function FlightPathModal({ icao, onClose }: FlightPathModalProps) {
  const [track, setTrack] = useState<FlightTrack | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)

  // Escape to close
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Fetch track data
  useEffect(() => {
    let cancelled = false
    async function fetchTrack() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/adsb/track/${encodeURIComponent(icao)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: FlightTrack = await res.json()
        if (!cancelled) setTrack(data)
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load track')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchTrack()
    return () => { cancelled = true }
  }, [icao])

  // Initialize map when track data is ready
  useEffect(() => {
    if (!track || track.sightings.length === 0 || !mapContainerRef.current) return
    if (mapInstanceRef.current) return

    let cancelled = false

    async function initMap() {
      const L = await import('leaflet')
      if (cancelled || !mapContainerRef.current) return

      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
        attributionControl: true,
      })

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 19,
      }).addTo(map)

      const points = track!.sightings
      const bounds: [number, number][] = points.map(p => [p.lat, p.lon])

      // Draw segment-by-segment polylines colored by altitude
      for (let i = 0; i < points.length - 1; i++) {
        const alt = points[i].alt_ft
        const color = alt != null
          ? alt > 30000 ? '#38bdf8'   // sky-400
          : alt > 15000 ? '#34d399'   // emerald-400
          : '#fbbf24'                  // amber-400
          : '#9ca3af'                  // gray-400

        L.polyline(
          [[points[i].lat, points[i].lon], [points[i + 1].lat, points[i + 1].lon]],
          { color, weight: 3, opacity: 0.8 },
        ).addTo(map)
      }

      // Start marker (green)
      const first = points[0]
      L.circleMarker([first.lat, first.lon], {
        radius: 7, fillColor: '#22c55e', color: '#166534',
        weight: 2, fillOpacity: 0.9,
      }).addTo(map).bindTooltip('Start', {
        permanent: false, direction: 'right', offset: [8, 0],
        className: 'flight-tooltip',
      })

      // End marker (red)
      const last = points[points.length - 1]
      L.circleMarker([last.lat, last.lon], {
        radius: 7, fillColor: '#ef4444', color: '#991b1b',
        weight: 2, fillOpacity: 0.9,
      }).addTo(map).bindTooltip('End', {
        permanent: false, direction: 'right', offset: [8, 0],
        className: 'flight-tooltip',
      })

      // Fit bounds
      map.fitBounds(bounds, { padding: [40, 40] })

      mapInstanceRef.current = map
    }

    initMap()
    return () => {
      cancelled = true
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [track])

  // Cleanup map on unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [])

  const ac = track?.aircraft
  const hasPositions = track && track.sightings.length > 0

  return (
    <div className="fixed inset-0 z-50 bg-gray-950/95 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl w-[90vw] max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-amber-400 font-bold">{icao}</span>
            {ac?.callsign && <span className="font-medium text-gray-200">{ac.callsign}</span>}
            {track && (
              <span className="text-xs text-gray-500 font-mono">
                {track.sightings.length} of {track.total_points} positions
                {track.total_points > track.sightings.length && ' (downsampled)'}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-lg px-2">
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0">
          {loading && (
            <div className="flex items-center justify-center h-96">
              <span className="text-gray-500 text-sm font-mono">Loading flight path...</span>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-96">
              <span className="text-red-400 text-sm">Error: {error}</span>
            </div>
          )}

          {!loading && !error && !hasPositions && (
            <div className="flex items-center justify-center h-96">
              <div className="text-center">
                <div className="text-gray-500 text-sm">No position data for this aircraft</div>
                <div className="text-gray-600 text-xs mt-1">Only aircraft with decoded lat/lon have flight paths</div>
              </div>
            </div>
          )}

          {!loading && !error && hasPositions && (
            <>
              <link
                rel="stylesheet"
                href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
                crossOrigin=""
              />
              <style>{`
                .flight-tooltip {
                  background: rgba(17, 24, 39, 0.95) !important;
                  border: 1px solid rgba(75, 85, 99, 0.5) !important;
                  color: #e5e7eb !important;
                  font-family: ui-monospace, monospace !important;
                  font-size: 11px !important;
                  padding: 4px 8px !important;
                  border-radius: 4px !important;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;
                }
                .flight-tooltip::before {
                  border-right-color: rgba(75, 85, 99, 0.5) !important;
                }
              `}</style>
              <div ref={mapContainerRef} style={{ height: '450px', width: '100%' }} />
            </>
          )}
        </div>

        {/* Footer */}
        {ac && (
          <div className="px-4 py-2 border-t border-gray-800 flex items-center justify-between text-xs text-gray-500">
            <div className="flex items-center gap-4">
              <span>First seen: <span className="text-gray-400 font-mono">{new Date(ac.first_seen).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></span>
              <span>Last seen: <span className="text-gray-400 font-mono">{new Date(ac.last_seen).toLocaleString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></span>
              <span>Total msgs: <span className="text-gray-400 font-mono">{ac.total_msgs.toLocaleString()}</span></span>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-sky-400 inline-block" /> FL300+
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> FL150-300
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Below FL150
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
