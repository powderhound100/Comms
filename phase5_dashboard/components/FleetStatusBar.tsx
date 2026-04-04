'use client'

import type { FleetSdrStatus } from '@/lib/fleet-bridge'

const MODE_COLORS: Record<string, string> = {
  adsb: 'text-cyan-400 border-cyan-700 bg-cyan-900/30',
  scanner: 'text-amber-400 border-amber-700 bg-amber-900/30',
  radio: 'text-emerald-400 border-emerald-700 bg-emerald-900/30',
}

const MODE_LABELS: Record<string, string> = {
  adsb: 'ADS-B',
  scanner: 'Scanner',
  radio: 'Radio',
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

interface FleetStatusBarProps {
  connected: boolean
  sdrs: (FleetSdrStatus & { nodeId: string })[]
  totalAircraft: number
  totalDetections: number
}

export default function FleetStatusBar({
  connected,
  sdrs,
  totalAircraft,
  totalDetections,
}: FleetStatusBarProps) {
  return (
    <div className="mb-6">
      {/* Connection status */}
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
        <span className={`text-sm font-medium ${connected ? 'text-emerald-400' : 'text-red-400'}`}>
          {connected ? 'Fleet Connected' : 'Fleet Disconnected'}
        </span>
        <span className="text-xs text-gray-500 font-mono ml-auto">
          {sdrs.filter(s => s.running).length}/{sdrs.length} SDRs active
        </span>
      </div>

      {/* SDR cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {sdrs.map(sdr => {
          const modeStyle = MODE_COLORS[sdr.mode] || 'text-gray-400 border-gray-700 bg-gray-900'
          return (
            <div
              key={`${sdr.nodeId}-${sdr.device_index}`}
              className={`rounded-lg p-3 border ${sdr.running ? modeStyle : 'border-gray-800 bg-gray-900/50 opacity-60'}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-mono text-gray-500">SDR {sdr.device_index}</span>
                <div className={`w-2 h-2 rounded-full ${sdr.running ? 'bg-emerald-400' : 'bg-gray-600'}`} />
              </div>
              <div className="text-sm font-medium truncate">{sdr.label}</div>
              <div className="flex items-center justify-between mt-1">
                <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${modeStyle}`}>
                  {MODE_LABELS[sdr.mode] || sdr.mode}
                </span>
                {sdr.running && (
                  <span className="text-[10px] text-gray-500 font-mono">
                    {formatUptime(sdr.uptime_s)}
                  </span>
                )}
              </div>
            </div>
          )
        })}

        {sdrs.length === 0 && (
          <div className="col-span-4 text-center py-8 text-gray-600 text-sm">
            No SDR fleet nodes connected
          </div>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Active SDRs</div>
          <div className="text-lg font-bold text-cyan-400 mt-1">
            {sdrs.filter(s => s.running).length}
          </div>
        </div>
        <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Aircraft Tracked</div>
          <div className="text-lg font-bold text-cyan-400 mt-1">{totalAircraft}</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Detections</div>
          <div className="text-lg font-bold text-amber-400 mt-1">{totalDetections}</div>
        </div>
      </div>
    </div>
  )
}
