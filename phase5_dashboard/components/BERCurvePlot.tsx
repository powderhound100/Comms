'use client'

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import berResultsData from '@/data/ber_results.json'
import berOtaData from '@/data/ber_results_ota.json'

export default function BERCurvePlot() {
  const simUncoded = berResultsData
    .filter(d => d.coding === 'none' && d.ber > 0)
    .map(d => ({ ebn0: d.ebn0Db, ber: d.ber }))

  const simCoded = berResultsData
    .filter(d => d.coding === 'conv_r12' && d.ber > 0)
    .map(d => ({ ebn0: d.ebn0Db, ber: d.ber }))

  const otaUncoded = berOtaData
    .filter(d => d.ber > 0)
    .map(d => ({ ebn0: d.ebn0Db, ber: d.ber }))

  // Merge all data into unified structure
  const allEbn0 = new Set([
    ...simUncoded.map(d => d.ebn0),
    ...simCoded.map(d => d.ebn0),
    ...otaUncoded.map(d => d.ebn0),
  ])

  const chartData = Array.from(allEbn0).sort((a, b) => a - b).map(ebn0 => ({
    ebn0,
    simUncoded: simUncoded.find(d => d.ebn0 === ebn0)?.ber,
    simCoded: simCoded.find(d => d.ebn0 === ebn0)?.ber,
    otaUncoded: otaUncoded.find(d => d.ebn0 === ebn0)?.ber,
  }))

  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
      <h3 className="text-lg font-semibold mb-4">BER vs Eb/N₀</h3>
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="ebn0" label={{ value: 'Eb/N₀ (dB)', position: 'bottom' }}
            stroke="#9CA3AF" />
          <YAxis scale="log" domain={[1e-7, 1]} stroke="#9CA3AF"
            tickFormatter={(v: number) => v.toExponential(0)} />
          <Tooltip
            contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
            formatter={(value: number) => value?.toExponential(2)} />
          <Legend />
          <Line type="monotone" dataKey="simUncoded" stroke="#3B82F6" name="Sim BPSK uncoded"
            dot={{ r: 3 }} strokeWidth={2} connectNulls />
          <Line type="monotone" dataKey="simCoded" stroke="#10B981" name="Sim BPSK coded r=1/2"
            dot={{ r: 3 }} strokeWidth={2} connectNulls />
          <Line type="monotone" dataKey="otaUncoded" stroke="#F59E0B" name="OTA BPSK uncoded"
            dot={{ r: 4 }} strokeWidth={2} strokeDasharray="5 5" connectNulls />
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-3 text-sm text-gray-500">
        Implementation loss (OTA vs Sim) visible as horizontal shift between yellow and blue curves.
        Coding gain (~5 dB) visible as shift between green and blue curves.
      </div>
    </div>
  )
}
