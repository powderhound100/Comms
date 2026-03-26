import {
  hardwareStack,
  noiseBudget,
  captureWorkflow,
  automationScripts,
  integrationRoadmap,
  captureChain,
} from '@/data/ground-station'
import SignalFlowDiagram from '@/components/SignalFlowDiagram'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-gray-800/50">
      <td className="py-1.5 text-gray-400 w-48">{label}</td>
      <td className="py-1.5 font-mono">{value}</td>
    </tr>
  )
}

export default function GroundStationPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Ground Station</h1>
        <p className="text-gray-400">
          SDR hardware architecture, automated capture workflows, and integration with sgoudelis/ground-station
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Total Hardware Cost</div>
          <div className="text-2xl font-bold text-blue-400">~$305</div>
          <div className="text-sm text-gray-500">Complete receive + transmit stack</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">System Noise Temp</div>
          <div className="text-2xl font-bold text-blue-400">105 K</div>
          <div className="text-sm text-gray-500">Cascaded LNA + cable + SDR</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Validated Sessions</div>
          <div className="text-2xl font-bold text-blue-400">10</div>
          <div className="text-sm text-gray-500">Predicted vs measured C/N₀</div>
        </div>
      </div>

      {/* Signal Flow Diagram */}
      <h2 className="text-xl font-semibold mb-4">Capture Signal Chain</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8">
        <SignalFlowDiagram chain={captureChain} />
      </div>

      {/* Hardware Stack */}
      <h2 className="text-xl font-semibold mb-4">Hardware Stack</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-left text-gray-400">
              <th className="py-2 pr-4">Component</th>
              <th className="py-2 pr-4">Model</th>
              <th className="py-2 pr-4">Spec</th>
              <th className="py-2 pr-4">Cost</th>
              <th className="py-2">Role</th>
            </tr>
          </thead>
          <tbody>
            {hardwareStack.map(hw => (
              <tr key={hw.name} className="border-b border-gray-800/50">
                <td className="py-1.5 pr-4 font-medium">{hw.name}</td>
                <td className="py-1.5 pr-4 font-mono text-gray-300">{hw.model}</td>
                <td className="py-1.5 pr-4 text-gray-400">{hw.spec}</td>
                <td className="py-1.5 pr-4 text-gray-300">{hw.cost}</td>
                <td className="py-1.5 text-gray-400">{hw.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Noise Budget Table */}
      <h2 className="text-xl font-semibold mb-4">Noise Budget</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-left text-gray-400">
              <th className="py-2 pr-4">Stage</th>
              <th className="py-2 pr-4">Gain (dB)</th>
              <th className="py-2 pr-4">Noise Figure (dB)</th>
              <th className="py-2">Noise Temp (K)</th>
            </tr>
          </thead>
          <tbody>
            {noiseBudget.map(row => (
              <tr key={row.stage} className="border-b border-gray-800/50">
                <td className="py-1.5 pr-4 font-medium">{row.stage}</td>
                <td className="py-1.5 pr-4 font-mono">{row.gain_dB > 0 ? `+${row.gain_dB}` : row.gain_dB}</td>
                <td className="py-1.5 pr-4 font-mono">{row.nf_dB}</td>
                <td className="py-1.5 font-mono">{row.noiseTemp_K} K</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-500 mt-2">
          Cascaded system noise temperature: ~105 K (dominated by LNA first stage per Friis equation)
        </p>
      </div>

      {/* Capture Workflow */}
      <h2 className="text-xl font-semibold mb-4">Capture Workflow</h2>
      <div className="space-y-2 mb-8">
        {captureWorkflow.map(step => (
          <div key={step.step} className="bg-gray-900 rounded-lg p-4 border border-gray-800 flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-blue-900/60 border border-blue-700 flex items-center justify-center text-sm font-bold text-blue-300">
              {step.step}
            </div>
            <div className="flex-1">
              <div className="font-medium">{step.name}</div>
              <div className="text-sm text-gray-500">{step.description}</div>
            </div>
            <code className="text-xs bg-gray-800 px-2 py-1 rounded text-gray-400">{step.script}</code>
            {step.automated && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-900/50 border-emerald-700 text-emerald-300">
                Automated
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Automation Scripts */}
      <h2 className="text-xl font-semibold mb-4">Automation Scripts</h2>
      <div className="space-y-4 mb-8">
        {automationScripts.map(script => (
          <div key={script.name} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <h3 className="font-semibold mb-1">{script.name}</h3>
            <div className="text-xs text-gray-500 mb-2">
              <code className="bg-gray-800 px-1.5 py-0.5 rounded">{script.file}</code>
            </div>
            <p className="text-sm text-gray-400 mb-3">{script.description}</p>
            <table className="w-full text-sm mb-2">
              <tbody>
                <Row label="Inputs" value={script.inputs} />
                <Row label="Outputs" value={script.outputs} />
              </tbody>
            </table>
            <table className="w-full text-sm">
              <tbody>
                {script.parameters.map(p => (
                  <Row key={p.label} label={p.label} value={p.value} />
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Integration Roadmap */}
      <h2 className="text-xl font-semibold mb-4">Integration Roadmap</h2>
      <p className="text-sm text-gray-400 mb-4">
        Feature mapping from <code className="bg-gray-800 px-1.5 py-0.5 rounded">sgoudelis/ground-station</code> to GROUNDLINK
      </p>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-left text-gray-400">
              <th className="py-2 pr-4">Feature</th>
              <th className="py-2 pr-4">Source</th>
              <th className="py-2 pr-4">GROUNDLINK Mapping</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {integrationRoadmap.map(item => (
              <tr key={item.feature} className="border-b border-gray-800/50">
                <td className="py-1.5 pr-4 font-medium">{item.feature}</td>
                <td className="py-1.5 pr-4 text-gray-400 font-mono text-xs">{item.source}</td>
                <td className="py-1.5 pr-4 text-gray-400">{item.groundlinkMapping}</td>
                <td className="py-1.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-900/50 border-amber-700 text-amber-300">
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
