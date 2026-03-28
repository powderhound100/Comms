'use client'

import { useEffect, useRef, useMemo } from 'react'
import type { TrackedAircraft } from '@/data/scan-detect'

interface AircraftMapProps {
  aircraft: TrackedAircraft[]
  /** Trail history: ICAO → array of [lat, lon] positions */
  trails: Record<string, [number, number][]>
  height?: number
}

export default function AircraftMap({ aircraft, trails, height = 450 }: AircraftMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMap = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())
  const trailLinesRef = useRef<Map<string, any>>(new Map())
  const markerStateRef = useRef<Map<string, { heading: number; altitude: number | null; source: string | undefined }>>(new Map())
  const LRef = useRef<any>(null)

  // Compute map center from aircraft positions
  const center = useMemo(() => {
    const withPos = aircraft.filter(a => a.latitude != null && a.longitude != null)
    if (withPos.length === 0) return [47.6062, -122.3321] as [number, number] // Seattle
    const avgLat = withPos.reduce((s, a) => s + a.latitude!, 0) / withPos.length
    const avgLon = withPos.reduce((s, a) => s + a.longitude!, 0) / withPos.length
    return [avgLat, avgLon] as [number, number]
  }, [aircraft])

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return

    let cancelled = false

    async function initMap() {
      const L = await import('leaflet')
      if (cancelled) return
      LRef.current = L

      // Fix default marker icon path issue in webpack/next.js
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const map = L.map(mapRef.current!, {
        center: center,
        zoom: 7,
        zoomControl: true,
        attributionControl: true,
      })

      // Dark tile layer matching dashboard theme
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 19,
      }).addTo(map)

      leafletMap.current = map
    }

    initMap()
    return () => { cancelled = true }
  }, [center])

  // Update markers and trails when aircraft data changes
  useEffect(() => {
    const map = leafletMap.current
    const L = LRef.current
    if (!map || !L) return

    const currentICAOs = new Set<string>()

    aircraft.forEach(ac => {
      if (ac.latitude == null || ac.longitude == null) return
      currentICAOs.add(ac.icao_hex)

      const pos: [number, number] = [ac.latitude, ac.longitude]

      // Build aircraft icon (rotated triangle)
      const rotation = ac.heading_deg ?? 0

      // Source-based coloring: 1090=cyan, 978=orange, both=purple, fallback=altitude
      const sourceColor = ac.source === '978' ? '#fb923c'    // orange-400
        : ac.source === 'both' ? '#c084fc'                   // purple-400
        : null                                                // use altitude color

      const altColor = sourceColor ?? (ac.altitude_ft != null
        ? ac.altitude_ft > 30000 ? '#38bdf8' // sky-400 (high)
        : ac.altitude_ft > 15000 ? '#34d399' // emerald-400 (mid)
        : '#fbbf24' // amber-400 (low)
        : '#9ca3af') // gray-400

      const iconHtml = `
        <div style="transform: rotate(${rotation}deg); width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="${altColor}" stroke="${altColor}" stroke-width="0.5">
            <path d="M12 2 L8 10 L3 12 L8 13 L10 22 L12 18 L14 22 L16 13 L21 12 L16 10 Z"/>
          </svg>
        </div>
      `

      const icon = L.divIcon({
        html: iconHtml,
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      })

      // Tooltip content
      const sourceTag = ac.source === '978' ? ' [UAT]'
        : ac.source === 'both' ? ' [1090+UAT]'
        : ''
      const tooltip = [
        `<b>${ac.callsign || ac.icao_hex}${sourceTag}</b>`,
        ac.altitude_ft != null ? `FL${Math.round(ac.altitude_ft / 100)}` : null,
        ac.ground_speed_kt != null ? `${ac.ground_speed_kt.toFixed(0)} kt` : null,
        ac.heading_deg != null ? `HDG ${ac.heading_deg.toFixed(0)}°` : null,
        ac.vertical_rate_fpm != null && ac.vertical_rate_fpm !== 0
          ? `${ac.vertical_rate_fpm > 0 ? '+' : ''}${ac.vertical_rate_fpm} fpm`
          : null,
      ].filter(Boolean).join(' | ')

      if (markersRef.current.has(ac.icao_hex)) {
        // Update existing marker — only recreate icon when visual state changes
        const marker = markersRef.current.get(ac.icao_hex)
        marker.setLatLng(pos)
        const cached = markerStateRef.current.get(ac.icao_hex)
        if (!cached || cached.heading !== rotation || cached.altitude !== ac.altitude_ft || cached.source !== ac.source) {
          marker.setIcon(icon)
          markerStateRef.current.set(ac.icao_hex, { heading: rotation, altitude: ac.altitude_ft ?? null, source: ac.source })
        }
        marker.setTooltipContent(tooltip)
      } else {
        // Create new marker
        const marker = L.marker(pos, { icon })
          .addTo(map)
          .bindTooltip(tooltip, {
            permanent: false,
            direction: 'right',
            offset: [12, 0],
            className: 'aircraft-tooltip',
          })
        markersRef.current.set(ac.icao_hex, marker)
        markerStateRef.current.set(ac.icao_hex, { heading: rotation, altitude: ac.altitude_ft ?? null, source: ac.source })
      }

      // Draw trajectory trail
      const trail = trails[ac.icao_hex]
      if (trail && trail.length >= 2) {
        if (trailLinesRef.current.has(ac.icao_hex)) {
          trailLinesRef.current.get(ac.icao_hex).setLatLngs(trail)
        } else {
          const line = L.polyline(trail, {
            color: altColor,
            weight: 2,
            opacity: 0.6,
            dashArray: '4 6',
          }).addTo(map)
          trailLinesRef.current.set(ac.icao_hex, line)
        }
      }
    })

    // Remove markers for aircraft no longer tracked
    markersRef.current.forEach((marker, icao) => {
      if (!currentICAOs.has(icao)) {
        map.removeLayer(marker)
        markersRef.current.delete(icao)
        markerStateRef.current.delete(icao)
      }
    })
    trailLinesRef.current.forEach((line, icao) => {
      if (!currentICAOs.has(icao)) {
        map.removeLayer(line)
        trailLinesRef.current.delete(icao)
      }
    })
  }, [aircraft, trails])

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h3 className="text-sm font-semibold">Aircraft Tracking Map</h3>
        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-sky-400 inline-block" /> FL300+
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> FL150-300
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Below FL150
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> UAT
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-purple-400 inline-block" /> Both
          </span>
          <span>{aircraft.filter(a => a.latitude != null).length} aircraft</span>
        </div>
      </div>
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        crossOrigin=""
      />
      <style>{`
        .aircraft-tooltip {
          background: rgba(17, 24, 39, 0.95) !important;
          border: 1px solid rgba(75, 85, 99, 0.5) !important;
          color: #e5e7eb !important;
          font-family: ui-monospace, monospace !important;
          font-size: 11px !important;
          padding: 4px 8px !important;
          border-radius: 4px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;
        }
        .aircraft-tooltip::before {
          border-right-color: rgba(75, 85, 99, 0.5) !important;
        }
        .leaflet-control-attribution {
          background: rgba(17, 24, 39, 0.8) !important;
          color: #6b7280 !important;
          font-size: 9px !important;
        }
        .leaflet-control-attribution a {
          color: #9ca3af !important;
        }
        .leaflet-control-zoom a {
          background: rgba(17, 24, 39, 0.9) !important;
          color: #e5e7eb !important;
          border-color: rgba(75, 85, 99, 0.5) !important;
        }
        .leaflet-control-zoom a:hover {
          background: rgba(31, 41, 55, 0.95) !important;
        }
      `}</style>
      <div ref={mapRef} style={{ height: `${height}px`, width: '100%' }} />
    </div>
  )
}
