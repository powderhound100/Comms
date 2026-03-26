import { flowgraphs, ootBlocks, signalChains, phaseSummaries } from '../../data/gnu-radio'
import SignalFlowDiagram from '../../components/SignalFlowDiagram'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-gray-800/50">
      <td className="py-1.5 text-gray-400 w-48">{label}</td>
      <td className="py-1.5 font-mono">{value}</td>
    </tr>
  )
}

export default function GnuRadioPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">GNU Radio</h1>
        <p className="text-gray-400">
          GRC flowgraphs, custom OOT blocks, and signal flow chains used across Phases 2–4
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">{phaseSummaries.phase2.title}</div>
          <div className="text-2xl font-bold text-blue-400">{phaseSummaries.phase2.count}</div>
          <div className="text-sm text-gray-500">{phaseSummaries.phase2.label}</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">{phaseSummaries.phase3.title}</div>
          <div className="text-2xl font-bold text-violet-400">{phaseSummaries.phase3.count}</div>
          <div className="text-sm text-gray-500">{phaseSummaries.phase3.label}</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">{phaseSummaries.phase4.title}</div>
          <div className="text-2xl font-bold text-amber-400">{phaseSummaries.phase4.count}</div>
          <div className="text-sm text-gray-500">{phaseSummaries.phase4.label}</div>
        </div>
      </div>

      {/* Signal Flow Diagrams */}
      <h2 className="text-xl font-semibold mb-4">Signal Flow Diagrams</h2>
      <div className="space-y-4 mb-8">
        {signalChains.map(chain => (
          <div key={chain.name} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <SignalFlowDiagram chain={chain} />
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-8 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-blue-900/60 border border-blue-700" />
          <span className="text-gray-400">Hardware</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-gray-800 border border-gray-600" />
          <span className="text-gray-400">DSP</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-emerald-900/60 border border-emerald-700" />
          <span className="text-gray-400">CCSDS</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-amber-900/60 border border-amber-700" />
          <span className="text-gray-400">Application</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-red-900/60 border border-red-700" />
          <span className="text-gray-400">Attenuator</span>
        </div>
      </div>

      {/* Phase 2 — GRC Flowgraphs */}
      <h2 className="text-xl font-semibold mb-1 text-blue-400">Phase 2 — Ground Station</h2>
      <p className="text-sm text-gray-400 mb-4">{phaseSummaries.phase2.description}</p>
      <div className="space-y-4 mb-8">
        {flowgraphs.map(fg => (
          <div key={fg.name} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <h3 className="font-semibold mb-1">{fg.name}</h3>
            <div className="text-xs text-gray-500 mb-2">
              <code className="bg-gray-800 px-1.5 py-0.5 rounded">{fg.file}</code>
            </div>
            <p className="text-sm text-gray-400 mb-3">{fg.description}</p>

            {/* Inline block chain */}
            <div className="overflow-x-auto mb-3">
              <div className="flex items-center gap-1 flex-wrap text-xs">
                {fg.blocks.map((block, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <span className="px-2 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-300 whitespace-nowrap">
                      {block}
                    </span>
                    {i < fg.blocks.length - 1 && (
                      <span className="text-gray-600">&rarr;</span>
                    )}
                  </span>
                ))}
              </div>
            </div>

            {/* Parameter table */}
            <table className="w-full text-sm">
              <tbody>
                {fg.parameters.map(p => (
                  <Row key={p.label} label={p.label} value={p.value} />
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Phase 3 — OOT Blocks */}
      <h2 className="text-xl font-semibold mb-1 text-violet-400">Phase 3 — CCSDS Modem</h2>
      <p className="text-sm text-gray-400 mb-4">{phaseSummaries.phase3.description}</p>
      <div className="space-y-4 mb-8">
        {ootBlocks.map(block => (
          <div key={block.className} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <h3 className="font-semibold font-mono mb-1">{block.className}</h3>
            <p className="text-sm text-gray-400 mb-2">{block.description}</p>
            <p className="text-sm text-gray-500 mb-3">{block.details}</p>
            <table className="w-full text-sm">
              <tbody>
                <Row label="Inputs" value={block.inputs} />
                <Row label="Outputs" value={block.outputs} />
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Phase 4 — Loopback */}
      <h2 className="text-xl font-semibold mb-1 text-amber-400">Phase 4 — Loopback</h2>
      <p className="text-sm text-gray-400 mb-4">{phaseSummaries.phase4.description}</p>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="font-semibold">Over-the-Air Loopback Test</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-900/50 border-amber-700 text-amber-300">
            Planned
          </span>
        </div>
        <p className="text-sm text-gray-400 mb-3">
          End-to-end hardware loopback connecting PlutoSDR TX through a 30 dB attenuator to RTL-SDR RX.
          Validates the complete CCSDS TM waveform chain including framing, coding, modulation, and BER measurement.
        </p>
        <table className="w-full text-sm">
          <tbody>
            <Row label="Carrier Frequency" value="2200 MHz (S-band)" />
            <Row label="Symbol Rate" value="256,000 sps" />
            <Row label="Attenuation" value="30 dB (inline pad)" />
            <Row label="Modulation" value="BPSK" />
            <Row label="FEC" value="Convolutional r=1/2, k=7" />
            <Row label="TX SDR" value="ADALM-Pluto" />
            <Row label="RX SDR" value="RTL-SDR Blog V4" />
          </tbody>
        </table>
      </div>
    </div>
  )
}
