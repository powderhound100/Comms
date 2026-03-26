'use client'

import { lookAnglesGeo, dopplerAtElevation } from '@/lib/orbital'

export default function PassesPage() {
  const goes18 = lookAnglesGeo(-137.2, 47.6, -122.3)

  const elevations = [0, 10, 20, 30, 45, 60, 90]
  const dopplerTable = elevations.map(el => ({
    el,
    doppler: dopplerAtElevation(1694.1e6, 7500, el),
  }))

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Satellite Pass Tracker</h1>
      <p className="text-gray-400 mb-6">
        Ground station: Seattle (47.6°N, 122.3°W)
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <h3 className="font-semibold mb-3">GOES-18 (GEO)</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Azimuth</span>
              <span className="font-mono">{goes18.azDeg.toFixed(1)}°</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Elevation</span>
              <span className="font-mono">{goes18.elDeg.toFixed(1)}°</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Visibility</span>
              <span className="text-emerald-400">Always visible</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Frequency</span>
              <span className="font-mono">1694.1 MHz</span>
            </div>
          </div>
        </div>

        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <h3 className="font-semibold mb-3">LEO Doppler (1694 MHz, 7.5 km/s)</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500">
                <th className="text-left py-1">Elevation</th>
                <th className="text-right py-1">Doppler Shift</th>
              </tr>
            </thead>
            <tbody>
              {dopplerTable.map(({ el, doppler }) => (
                <tr key={el} className="border-t border-gray-800/50">
                  <td className="py-1">{el}°</td>
                  <td className="text-right font-mono">
                    ±{(doppler / 1000).toFixed(1)} kHz
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
