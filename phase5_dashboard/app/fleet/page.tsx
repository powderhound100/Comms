'use client'

import { useFleet } from '@/hooks/use-fleet'
import FleetStatusBar from '@/components/FleetStatusBar'
import AircraftMap from '@/components/AircraftMap'
import type { TrackedAircraft } from '@/data/scan-detect'

const SDR_COLORS: Record<number, string> = {
  0: 'text-cyan-400',
  1: 'text-amber-400',
  2: 'text-emerald-400',
  3: 'text-purple-400',
}

export default function FleetPage() {
  const { connected, overview, aircraft, sdrData, getSdrList } = useFleet()
  const sdrList = getSdrList()

  // Convert fleet aircraft to TrackedAircraft for the map
  const mapAircraft: TrackedAircraft[] = aircraft.map(ac => ({
    icao_hex: ac.icao,
    callsign: ac.callsign || null,
    latitude: ac.lat ?? null,
    longitude: ac.lon ?? null,
    altitude_ft: ac.alt_ft ?? null,
    ground_speed_kt: ac.gs_kt ?? null,
    heading_deg: ac.hdg ?? null,
    vertical_rate_fpm: ac.vr_fpm ?? null,
    squawk: null,
    on_ground: ac.on_ground ?? false,
  }))

  // Per-SDR data summaries
  const sdrSummaries = Object.entries(sdrData).map(([key, data]) => {
    const [nodeId, deviceStr] = key.split(':')
    const deviceIndex = parseInt(deviceStr)
    const sdr = sdrList.find(s => s.device_index === deviceIndex && s.nodeId === nodeId)
    return {
      key,
      nodeId,
      deviceIndex,
      label: sdr?.label || `SDR ${deviceIndex}`,
      mode: data.mode,
      dataType: data.dataType,
      updatedAt: data.updatedAt,
      data: data.data,
    }
  })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">SDR Fleet</h1>
        <p className="text-gray-400 text-sm">
          Multi-SDR deployment — {sdrList.length} receivers across {Object.keys(overview?.nodes || {}).length} node(s)
        </p>
      </div>

      <FleetStatusBar
        connected={connected}
        sdrs={sdrList}
        totalAircraft={aircraft.length}
        totalDetections={overview?.total_detections ?? 0}
      />

      {/* Combined Aircraft Map */}
      {aircraft.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 mb-6 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-800 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-300">Combined Aircraft Map</span>
            <span className="text-xs text-gray-500 font-mono">
              {mapAircraft.filter(a => a.latitude != null).length} with position
            </span>
          </div>
          <AircraftMap aircraft={mapAircraft} trails={{}} height={500} />
        </div>
      )}

      {/* Aircraft Table (merged from all ADS-B SDRs) */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 mb-6 overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-800 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-300">Aircraft (All SDRs)</span>
          <span className="text-xs text-gray-500 font-mono">{aircraft.length} tracked</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-left">
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">ICAO</th>
                <th className="px-3 py-2">Callsign</th>
                <th className="px-3 py-2">Altitude</th>
                <th className="px-3 py-2">Speed</th>
                <th className="px-3 py-2">Heading</th>
                <th className="px-3 py-2">Position</th>
              </tr>
            </thead>
            <tbody>
              {aircraft.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-gray-600">
                    {connected ? 'Waiting for aircraft data...' : 'Fleet not connected'}
                  </td>
                </tr>
              ) : (
                aircraft.map(ac => (
                  <tr key={ac.icao} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-3 py-1.5">
                      <span className={`text-[10px] font-mono ${SDR_COLORS[ac._source_sdr] || 'text-gray-400'}`}>
                        SDR {ac._source_sdr}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-amber-400">{ac.icao}</td>
                    <td className="px-3 py-1.5 font-medium">
                      {ac.callsign || <span className="text-gray-600">---</span>}
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {ac.alt_ft != null
                        ? `${ac.alt_ft.toLocaleString()} ft`
                        : <span className="text-gray-600">---</span>
                      }
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {ac.gs_kt != null
                        ? `${ac.gs_kt.toFixed(0)} kt`
                        : <span className="text-gray-600">---</span>
                      }
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {ac.hdg != null
                        ? `${ac.hdg.toFixed(0)}\u00B0`
                        : <span className="text-gray-600">---</span>
                      }
                    </td>
                    <td className="px-3 py-1.5 font-mono text-gray-400">
                      {ac.lat != null && ac.lon != null
                        ? `${ac.lat.toFixed(3)}, ${ac.lon.toFixed(3)}`
                        : <span className="text-gray-600">no fix</span>
                      }
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-SDR Activity Feed */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 mb-6 overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-800">
          <span className="text-sm font-medium text-gray-300">SDR Activity</span>
        </div>
        <div className="divide-y divide-gray-800/50">
          {sdrSummaries.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-600 text-sm">
              No SDR data received yet
            </div>
          ) : (
            sdrSummaries.map(s => (
              <div key={s.key} className="px-4 py-2 flex items-center gap-3">
                <span className={`text-xs font-mono ${SDR_COLORS[s.deviceIndex] || 'text-gray-400'}`}>
                  SDR {s.deviceIndex}
                </span>
                <span className="text-xs text-gray-300">{s.label}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-300">
                  {s.mode}
                </span>
                <span className="text-[10px] text-gray-500">{s.dataType}</span>
                <span className="text-[10px] text-gray-600 ml-auto font-mono">
                  {new Date(s.updatedAt).toLocaleTimeString()}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
