import {
  rfParameters,
  messageTypes,
  hardware,
  software,
  integrationScenarios,
  decodeChain,
} from '@/data/ads-b'
import SignalFlowDiagram from '@/components/SignalFlowDiagram'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-gray-800/50">
      <td className="py-1.5 text-gray-400 w-48">{label}</td>
      <td className="py-1.5 font-mono">{value}</td>
    </tr>
  )
}

export default function ADSBPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">ADS-B Aircraft Tracking</h1>
        <p className="text-gray-400">
          Mode S Extended Squitter decoding with RTL-SDR — a practical first SDR project
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Frequency</div>
          <div className="text-2xl font-bold text-cyan-400">1090 MHz</div>
          <div className="text-sm text-gray-500">Mode S Extended Squitter</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Modulation</div>
          <div className="text-2xl font-bold text-cyan-400">PPM</div>
          <div className="text-sm text-gray-500">Pulse Position Modulation</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Typical Range</div>
          <div className="text-2xl font-bold text-cyan-400">~250 nm</div>
          <div className="text-sm text-gray-500">Line-of-sight coverage</div>
        </div>
      </div>

      {/* What is ADS-B? */}
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8">
        <h2 className="text-lg font-semibold mb-2">What is ADS-B?</h2>
        <p className="text-sm text-gray-400">
          Automatic Dependent Surveillance–Broadcast (ADS-B) is a surveillance technology where aircraft
          broadcast their GPS-derived position, velocity, and identification on 1090 MHz. Using an
          RTL-SDR and a simple quarter-wave antenna, anyone can receive and decode these transmissions
          to track aircraft in real time. ADS-B is an ideal first RTL-SDR project — the signals are
          strong (125–500 W transmit power), the protocol is well-documented, and tools like dump1090
          and tar1090 provide immediate visual feedback on a web-based map.
        </p>
      </div>

      {/* Signal Flow Diagram */}
      <h2 className="text-xl font-semibold mb-4">Decode Pipeline</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8">
        <SignalFlowDiagram chain={decodeChain} />
      </div>

      {/* RF Parameters */}
      <h2 className="text-xl font-semibold mb-4">RF Parameters</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8">
        <table className="w-full text-sm">
          <tbody>
            {rfParameters.map(p => (
              <Row key={p.label} label={p.label} value={p.value} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Hardware */}
      <h2 className="text-xl font-semibold mb-4">Hardware</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-left text-gray-400">
              <th className="py-2 pr-4">Component</th>
              <th className="py-2 pr-4">Spec</th>
              <th className="py-2 pr-4">Cost</th>
              <th className="py-2">Shared</th>
            </tr>
          </thead>
          <tbody>
            {hardware.map(hw => (
              <tr key={hw.name} className="border-b border-gray-800/50">
                <td className="py-1.5 pr-4 font-medium">{hw.name}</td>
                <td className="py-1.5 pr-4 text-gray-400">{hw.spec}</td>
                <td className="py-1.5 pr-4 font-mono">{hw.cost}</td>
                <td className="py-1.5">
                  {hw.sharedWithGroundlink && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-blue-900/50 border-blue-700 text-blue-300">
                      Shared with GROUNDLINK
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Message Types */}
      <h2 className="text-xl font-semibold mb-4">ADS-B Message Types</h2>
      <div className="space-y-4 mb-8">
        {messageTypes.map(msg => (
          <div key={msg.name} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-semibold">{msg.name}</h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-cyan-900/50 border-cyan-700 text-cyan-300">
                {msg.typeCodeRange}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {msg.fields.map(field => (
                <span key={field} className="text-xs px-2 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-300">
                  {field}
                </span>
              ))}
            </div>
            <div className="text-xs text-gray-500">
              Example: <code className="bg-gray-800 px-1.5 py-0.5 rounded font-mono">{msg.example}</code>
            </div>
          </div>
        ))}
      </div>

      {/* Software Stack */}
      <h2 className="text-xl font-semibold mb-4">Software Stack</h2>
      <div className="space-y-4 mb-8">
        {software.map(sw => (
          <div key={sw.name} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <h3 className="font-semibold mb-1">{sw.name}</h3>
            <p className="text-sm text-gray-400 mb-2">{sw.description}</p>
            <div className="bg-gray-800 rounded p-2 font-mono text-xs text-gray-300 mb-2 overflow-x-auto">
              $ {sw.installCommand}
            </div>
            <div className="text-xs text-gray-500">
              <code className="bg-gray-800 px-1.5 py-0.5 rounded">{sw.url}</code>
            </div>
          </div>
        ))}
      </div>

      {/* GROUNDLINK Integration */}
      <h2 className="text-xl font-semibold mb-4">GROUNDLINK Integration</h2>
      <div className="space-y-4">
        {integrationScenarios.map(scenario => (
          <div key={scenario.name} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <h3 className="font-semibold mb-1">{scenario.name}</h3>
            <p className="text-sm text-gray-400 mb-2">{scenario.description}</p>
            <p className="text-xs text-gray-500">{scenario.details}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
