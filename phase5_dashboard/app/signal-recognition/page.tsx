import {
  modulationTypes,
  mlApproaches,
  datasets,
  pipelineStages,
  tools,
  amrChain,
} from '@/data/signal-recognition'
import SignalFlowDiagram from '@/components/SignalFlowDiagram'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-gray-800/50">
      <td className="py-1.5 text-gray-400 w-48">{label}</td>
      <td className="py-1.5 font-mono">{value}</td>
    </tr>
  )
}

const relevanceBadge: Record<string, string> = {
  primary: 'bg-fuchsia-900/50 border-fuchsia-700 text-fuchsia-300',
  detectable: 'bg-blue-900/50 border-blue-700 text-blue-300',
  reference: 'bg-gray-800 border-gray-600 text-gray-400',
}

export default function SignalRecognitionPage() {
  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold">Signal Recognition</h1>
          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-900/50 border-emerald-700 text-emerald-300">
            Active
          </span>
        </div>
        <p className="text-gray-400">
          Automatic Modulation Recognition (AMR) with machine learning and RTL-SDR
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Modulation Types</div>
          <div className="text-2xl font-bold text-fuchsia-400">12</div>
          <div className="text-sm text-gray-500">Analog, digital, multi-carrier</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Target Accuracy</div>
          <div className="text-2xl font-bold text-fuchsia-400">&gt;90%</div>
          <div className="text-sm text-gray-500">At SNR &gt; 0 dB</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">RadioML Classes</div>
          <div className="text-2xl font-bold text-fuchsia-400">24</div>
          <div className="text-sm text-gray-500">RadioML 2018.01a benchmark</div>
        </div>
      </div>

      {/* What is AMR? */}
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8">
        <h2 className="text-lg font-semibold mb-2">What is Automatic Modulation Recognition?</h2>
        <p className="text-sm text-gray-400">
          Automatic Modulation Recognition (AMR) is the task of identifying the modulation scheme of a
          received radio signal without prior knowledge of its transmission parameters. Using machine
          learning — particularly convolutional neural networks trained on IQ sample data — AMR systems
          can classify signals in real time, enabling spectrum monitoring, interference identification,
          and adaptive receiver configuration. For GROUNDLINK, AMR extends the RTL-SDR and GNU Radio
          stack with intelligent signal identification, bridging the gap between raw RF capture and
          protocol-aware decoding.
        </p>
      </div>

      {/* Signal Flow Diagram */}
      <h2 className="text-xl font-semibold mb-4">AMR Pipeline</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8">
        <SignalFlowDiagram chain={amrChain} />
      </div>

      {/* ML Approaches */}
      <h2 className="text-xl font-semibold mb-4">ML Approaches</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {mlApproaches.map(approach => (
          <div key={approach.name} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <h3 className="font-semibold mb-1">{approach.name}</h3>
            <p className="text-sm text-gray-400 mb-2">{approach.architecture}</p>
            <table className="w-full text-sm mb-3">
              <tbody>
                <Row label="Input Type" value={approach.inputType} />
              </tbody>
            </table>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-emerald-400 font-medium mb-1">Pros</div>
                <ul className="space-y-0.5 text-gray-400">
                  {approach.pros.map(p => (
                    <li key={p}>+ {p}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-red-400 font-medium mb-1">Cons</div>
                <ul className="space-y-0.5 text-gray-400">
                  {approach.cons.map(c => (
                    <li key={c}>- {c}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modulation Types */}
      <h2 className="text-xl font-semibold mb-4">Modulation Types</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-left text-gray-400">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Category</th>
              <th className="py-2 pr-4">Description</th>
              <th className="py-2">Relevance</th>
            </tr>
          </thead>
          <tbody>
            {modulationTypes.map(mod => (
              <tr key={mod.name} className="border-b border-gray-800/50">
                <td className="py-1.5 pr-4 font-mono font-medium">{mod.name}</td>
                <td className="py-1.5 pr-4 text-gray-400">{mod.category}</td>
                <td className="py-1.5 pr-4 text-gray-400">{mod.description}</td>
                <td className="py-1.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${relevanceBadge[mod.relevance]}`}>
                    {mod.relevance}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Datasets */}
      <h2 className="text-xl font-semibold mb-4">Benchmark Datasets</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {datasets.map(ds => (
          <div key={ds.name} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <h3 className="font-semibold mb-2">{ds.name}</h3>
            <table className="w-full text-sm mb-2">
              <tbody>
                <Row label="Modulations" value={String(ds.modulations)} />
                <Row label="Samples" value={ds.samples} />
                <Row label="SNR Range" value={ds.snrRange} />
              </tbody>
            </table>
            <p className="text-xs text-gray-500">{ds.description}</p>
          </div>
        ))}
      </div>

      {/* Proposed Pipeline */}
      <h2 className="text-xl font-semibold mb-4">Proposed Pipeline</h2>
      <div className="space-y-2 mb-8">
        {pipelineStages.map(stage => (
          <div key={stage.step} className="bg-gray-900 rounded-lg p-4 border border-gray-800 flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-fuchsia-900/60 border border-fuchsia-700 flex items-center justify-center text-sm font-bold text-fuchsia-300">
              {stage.step}
            </div>
            <div className="flex-1">
              <div className="font-medium">{stage.name}</div>
              <div className="text-sm text-gray-500">{stage.description}</div>
            </div>
            <code className="text-xs bg-gray-800 px-2 py-1 rounded text-gray-400">{stage.tool}</code>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
              stage.status === 'complete' ? 'bg-emerald-900/50 border-emerald-700 text-emerald-300' :
              stage.status === 'active' ? 'bg-blue-900/50 border-blue-700 text-blue-300' :
              'bg-amber-900/50 border-amber-700 text-amber-300'
            }`}>
              {stage.status}
            </span>
          </div>
        ))}
      </div>

      {/* Tools & Frameworks */}
      <h2 className="text-xl font-semibold mb-4">Tools &amp; Frameworks</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-left text-gray-400">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2">URL</th>
            </tr>
          </thead>
          <tbody>
            {tools.map(tool => (
              <tr key={tool.name} className="border-b border-gray-800/50">
                <td className="py-1.5 pr-4 font-medium">{tool.name}</td>
                <td className="py-1.5 pr-4 text-gray-400">{tool.role}</td>
                <td className="py-1.5 font-mono text-xs text-blue-400">{tool.url}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* GROUNDLINK Integration */}
      <h2 className="text-xl font-semibold mb-4">GROUNDLINK Integration</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
        <p className="text-sm text-gray-400 mb-3">
          Signal recognition connects directly to the existing GROUNDLINK hardware and software stack.
          The RTL-SDR V4 already captures IQ data for satellite reception — the same hardware feeds the
          AMR pipeline. GNU Radio flowgraphs from Phase 2 provide the IQ capture and preprocessing
          stages, while the trained CNN model integrates as a custom OOT block in the gr-groundlink module.
        </p>
        <table className="w-full text-sm">
          <tbody>
            <Row label="SDR Hardware" value="RTL-SDR Blog V4 (shared with ground station)" />
            <Row label="IQ Capture" value="GNU Radio IQ Recorder flowgraph (Phase 2)" />
            <Row label="Training Data" value="RadioML 2016.10a / 2018.01a datasets" />
            <Row label="Inference" value="TensorFlow Lite or ONNX Runtime for real-time" />
            <Row label="Integration" value="gr-groundlink OOT block (Phase 3 pattern)" />
          </tbody>
        </table>
      </div>
    </div>
  )
}
