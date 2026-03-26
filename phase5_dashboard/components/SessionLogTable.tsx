'use client'

import sessions from '@/data/session_log.json'

export default function SessionLogTable() {
  const meanDelta = sessions.reduce((sum, s) => sum + Math.abs(s.deltaDb), 0) / sessions.length

  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Reception Sessions</h3>
        <div className="text-sm text-gray-400">
          Mean |delta|: <span className="text-white font-mono">{meanDelta.toFixed(2)} dB</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left py-2 px-2">ID</th>
              <th className="text-left py-2 px-2">Date</th>
              <th className="text-left py-2 px-2">Satellite</th>
              <th className="text-right py-2 px-2">Freq (MHz)</th>
              <th className="text-right py-2 px-2">El (°)</th>
              <th className="text-right py-2 px-2">Predicted</th>
              <th className="text-right py-2 px-2">Measured</th>
              <th className="text-right py-2 px-2">Delta</th>
              <th className="text-center py-2 px-2">OK</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(s => {
              const deltaColor = Math.abs(s.deltaDb) < 1 ? 'text-emerald-400' :
                Math.abs(s.deltaDb) < 2 ? 'text-amber-400' : 'text-red-400'
              return (
                <tr key={s.sessionId} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="py-2 px-2 font-mono">{s.sessionId}</td>
                  <td className="py-2 px-2">{s.datetimeUtc.split('T')[0]}</td>
                  <td className="py-2 px-2">{s.satellite}</td>
                  <td className="py-2 px-2 text-right font-mono">{s.freqMhz}</td>
                  <td className="py-2 px-2 text-right font-mono">{s.elevationDeg}</td>
                  <td className="py-2 px-2 text-right font-mono">{s.predictedCn0Dbhz.toFixed(1)}</td>
                  <td className="py-2 px-2 text-right font-mono">{s.measuredCn0Dbhz.toFixed(1)}</td>
                  <td className={`py-2 px-2 text-right font-mono ${deltaColor}`}>
                    {s.deltaDb > 0 ? '+' : ''}{s.deltaDb.toFixed(1)}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {s.decodedOk ? '✓' : '✗'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
