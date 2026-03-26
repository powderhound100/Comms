import {
  frequencyBands,
  knownSignals,
  classificationHistory,
  mlModels,
  monitorChain,
} from '@/data/signal-monitor'
import SignalFlowDiagram from '@/components/SignalFlowDiagram'
import ClassificationResultCard from '@/components/ClassificationResultCard'
import WaterfallDisplay from '@/components/WaterfallDisplay'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-gray-800/50">
      <td className="py-1.5 text-gray-400 w-48">{label}</td>
      <td className="py-1.5 font-mono">{value}</td>
    </tr>
  )
}

function confidenceBar(confidence: number) {
  const pct = Math.round(confidence * 100)
  const color = pct >= 90 ? 'bg-emerald-500' : pct >= 75 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-gray-400">{pct}%</span>
    </div>
  )
}

export default function SignalMonitorPage() {
  const avgAccuracy = classificationHistory.reduce((sum, r) => sum + r.confidence, 0) / classificationHistory.length
  const uniqueModulations = new Set(classificationHistory.map(r => r.modulationType))

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Signal Monitor</h1>
        <p className="text-gray-400">
          AI-powered RF signal identification and classification
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">ML Models Available</div>
          <div className="text-2xl font-bold text-fuchsia-400">{mlModels.length}</div>
          <div className="text-sm text-gray-500">VTCNN2 + ResNet1D</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Modulations Recognized</div>
          <div className="text-2xl font-bold text-fuchsia-400">{uniqueModulations.size}</div>
          <div className="text-sm text-gray-500">Unique types classified</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Avg Classification Confidence</div>
          <div className="text-2xl font-bold text-fuchsia-400">{(avgAccuracy * 100).toFixed(1)}%</div>
          <div className="text-sm text-gray-500">Across recent detections</div>
        </div>
      </div>

      {/* Signal Flow Diagram */}
      <h2 className="text-xl font-semibold mb-4">Monitor Pipeline</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8">
        <SignalFlowDiagram chain={monitorChain} />
      </div>

      {/* ML Models */}
      <h2 className="text-xl font-semibold mb-4">ML Models</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {mlModels.map(model => (
          <div key={model.name} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-semibold">{model.name}</h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-fuchsia-900/50 border-fuchsia-700 text-fuchsia-300">
                Phase 6
              </span>
            </div>
            <p className="text-sm text-gray-400 mb-3">{model.description}</p>
            <table className="w-full text-sm">
              <tbody>
                <Row label="Architecture" value={model.architecture} />
                <Row label="Input Shape" value={model.inputShape} />
                <Row label="Accuracy" value={model.accuracy} />
                <Row label="Dataset" value={model.dataset} />
                <Row label="Modulations" value={String(model.modulationsSupported)} />
                <Row label="Inference Time" value={`${model.inferenceTimeMs} ms`} />
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Known Signals Catalog */}
      <h2 className="text-xl font-semibold mb-4">Known Signals Catalog</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-left text-gray-400">
              <th className="py-2 pr-4">Signal</th>
              <th className="py-2 pr-4">Frequency</th>
              <th className="py-2 pr-4">Bandwidth</th>
              <th className="py-2 pr-4">Modulation</th>
              <th className="py-2 pr-4">Data Rate</th>
              <th className="py-2 pr-4">Source</th>
              <th className="py-2">Auto-Decode</th>
            </tr>
          </thead>
          <tbody>
            {knownSignals.map(sig => (
              <tr key={sig.name} className="border-b border-gray-800/50">
                <td className="py-1.5 pr-4 font-medium">{sig.name}</td>
                <td className="py-1.5 pr-4 font-mono text-gray-300">{sig.frequencyMhz} MHz</td>
                <td className="py-1.5 pr-4 font-mono text-gray-400">{sig.bandwidthKhz} kHz</td>
                <td className="py-1.5 pr-4 text-gray-300">{sig.modulation}</td>
                <td className="py-1.5 pr-4 font-mono text-gray-400">{sig.dataRate}</td>
                <td className="py-1.5 pr-4 text-gray-400">{sig.source}</td>
                <td className="py-1.5">
                  {sig.autoDecodable ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-900/50 border-emerald-700 text-emerald-300">Yes</span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-800 border-gray-600 text-gray-400">No</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Classification History */}
      <h2 className="text-xl font-semibold mb-4">Classification History</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-left text-gray-400">
              <th className="py-2 pr-4">Time</th>
              <th className="py-2 pr-4">Frequency</th>
              <th className="py-2 pr-4">Modulation</th>
              <th className="py-2 pr-4 w-40">Confidence</th>
              <th className="py-2 pr-4">SNR</th>
              <th className="py-2 pr-4">Model</th>
              <th className="py-2">Latency</th>
            </tr>
          </thead>
          <tbody>
            {classificationHistory.map((result, i) => (
              <tr key={i} className="border-b border-gray-800/50">
                <td className="py-1.5 pr-4 font-mono text-xs text-gray-400">
                  {new Date(result.timestamp).toLocaleTimeString()}
                </td>
                <td className="py-1.5 pr-4 font-mono text-gray-300">{result.frequencyMhz} MHz</td>
                <td className="py-1.5 pr-4 font-medium">{result.modulationType}</td>
                <td className="py-1.5 pr-4">{confidenceBar(result.confidence)}</td>
                <td className="py-1.5 pr-4 font-mono text-gray-400">{result.snrDb} dB</td>
                <td className="py-1.5 pr-4">
                  <span className="text-[10px] px-1.5 py-0.5 rounded border bg-fuchsia-900/50 border-fuchsia-700 text-fuchsia-300">
                    {result.modelUsed}
                  </span>
                </td>
                <td className="py-1.5 font-mono text-gray-400">{result.inferenceTimeMs} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Waterfall Display */}
      <h2 className="text-xl font-semibold mb-4">Waterfall Spectrogram</h2>
      <div className="mb-8">
        <WaterfallDisplay centerFreqMhz={137.9} spanMhz={1.2} />
      </div>

      {/* Classification Result Cards */}
      <h2 className="text-xl font-semibold mb-4">Recent Classifications</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {classificationHistory.slice(0, 3).map((result, i) => (
          <ClassificationResultCard key={i} result={result} />
        ))}
      </div>

      {/* Frequency Bands */}
      <h2 className="text-xl font-semibold mb-4">Frequency Band Overview</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {frequencyBands.map(band => (
          <div key={band.name} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-semibold">{band.name}</h3>
              <span className="text-xs font-mono text-gray-500">{band.rangeMhz}</span>
            </div>
            <p className="text-sm text-gray-400 mb-3">{band.description}</p>
            <div className="flex flex-wrap gap-1">
              {band.knownSignals.map(sig => (
                <span key={sig} className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-800 border-gray-700 text-gray-400">
                  {sig}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Roadmap */}
      <h2 className="text-xl font-semibold mb-4">Real-Time Integration Roadmap</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
        <p className="text-sm text-gray-400 mb-4">
          The Signal Monitor bridges Phase 6 ML classification with the Phase 2 ground station hardware.
          Once connected, the system will continuously scan configured frequency bands, classify detected
          signals in real time, and automatically trigger decoding pipelines for known signal types.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-left text-gray-400">
              <th className="py-2 pr-4">Capability</th>
              <th className="py-2 pr-4">Dependencies</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {[
              { capability: 'Live waterfall spectrogram', deps: 'WebSocket server, SDR bridge script', status: 'planned' },
              { capability: 'Real-time ML classification', deps: 'Python inference bridge, WebSocket', status: 'planned' },
              { capability: 'Auto-decode trigger', deps: 'SatDump CLI wrapper, signal catalog', status: 'planned' },
              { capability: 'SDR frequency control', deps: 'RTL-SDR API, control panel component', status: 'planned' },
              { capability: 'Multi-SDR orchestration', deps: 'SDR manager, scheduler', status: 'future' },
            ].map(item => (
              <tr key={item.capability} className="border-b border-gray-800/50">
                <td className="py-1.5 pr-4 font-medium">{item.capability}</td>
                <td className="py-1.5 pr-4 text-gray-400">{item.deps}</td>
                <td className="py-1.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    item.status === 'future'
                      ? 'bg-gray-800 border-gray-600 text-gray-400'
                      : 'bg-amber-900/50 border-amber-700 text-amber-300'
                  }`}>
                    {item.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
