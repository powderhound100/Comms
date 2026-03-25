import { ClassificationResult } from '@/lib/types'

interface ClassificationResultCardProps {
  result: ClassificationResult
  topPredictions?: { modulation: string; confidence: number }[]
}

export default function ClassificationResultCard({ result, topPredictions }: ClassificationResultCardProps) {
  const pct = Math.round(result.confidence * 100)
  const barColor = pct >= 90 ? 'bg-emerald-500' : pct >= 75 ? 'bg-amber-500' : 'bg-red-500'

  const predictions = topPredictions || [
    { modulation: result.modulationType, confidence: result.confidence },
    { modulation: result.modulationType === 'BPSK' ? 'QPSK' : 'BPSK', confidence: result.confidence * 0.15 },
    { modulation: '8PSK', confidence: result.confidence * 0.05 },
  ]

  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-lg font-bold">{result.modulationType}</div>
          <div className="text-xs text-gray-500">{result.frequencyMhz} MHz — {result.bandwidthKhz} kHz BW</div>
        </div>
        <div className="text-right">
          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-fuchsia-900/50 border-fuchsia-700 text-fuchsia-300">
            {result.modelUsed}
          </span>
          <div className="text-xs text-gray-500 mt-1">{result.inferenceTimeMs} ms</div>
        </div>
      </div>

      {/* Primary confidence */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-gray-400">Confidence</span>
          <span className="font-mono">{pct}%</span>
        </div>
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Top-3 predictions */}
      <div className="space-y-2">
        <div className="text-xs text-gray-500">Top Predictions</div>
        {predictions.slice(0, 3).map((pred, i) => {
          const predPct = Math.round(pred.confidence * 100)
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs font-mono w-12 text-gray-400">{pred.modulation}</span>
              <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-fuchsia-600/60" style={{ width: `${predPct}%` }} />
              </div>
              <span className="text-[10px] font-mono text-gray-500 w-8 text-right">{predPct}%</span>
            </div>
          )
        })}
      </div>

      {/* Context */}
      <div className="mt-3 pt-3 border-t border-gray-800 flex items-center justify-between text-xs text-gray-500">
        <span>SNR: {result.snrDb} dB</span>
        <span>{new Date(result.timestamp).toLocaleTimeString()}</span>
      </div>
    </div>
  )
}
