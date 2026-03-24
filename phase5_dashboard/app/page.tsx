export default function Home() {
  const phases = [
    { num: 1, title: 'Link Budget Engine', status: 'Complete', desc: 'Python link budget tool validated against CCSDS references' },
    { num: 2, title: 'SDR Ground Station', status: 'Complete', desc: 'GOES LRIT reception, predicted vs measured C/N₀ validation' },
    { num: 3, title: 'CCSDS TM Waveform', status: 'Complete', desc: 'GNU Radio CCSDS modem, BER vs Eb/N₀ curves' },
    { num: 4, title: 'Over-the-Air Loopback', status: 'Complete', desc: 'SDR hardware TX/RX, AES-256 encryption, ICD document' },
    { num: 5, title: 'Integration Dashboard', status: 'Active', desc: 'Next.js dashboard, documentation, blog series' },
  ]

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">GROUNDLINK</h1>
        <p className="text-gray-400">
          LEO Satellite Communications — Test & Validation Platform
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">GOES-18 LRIT</div>
          <div className="text-2xl font-bold text-emerald-400">+11.9 dB</div>
          <div className="text-sm text-gray-500">Link Margin</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">System Noise Temp</div>
          <div className="text-2xl font-bold text-blue-400">105 K</div>
          <div className="text-sm text-gray-500">SAWbird+ GOES + RTL-SDR</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Sessions Logged</div>
          <div className="text-2xl font-bold text-amber-400">10</div>
          <div className="text-sm text-gray-500">Mean error: 1.17 dB</div>
        </div>
      </div>

      <h2 className="text-xl font-semibold mb-4">Project Phases</h2>
      <div className="space-y-3">
        {phases.map(phase => (
          <div key={phase.num} className="bg-gray-900 rounded-lg p-4 border border-gray-800 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-sm font-bold">
              {phase.num}
            </div>
            <div className="flex-1">
              <div className="font-medium">{phase.title}</div>
              <div className="text-sm text-gray-500">{phase.desc}</div>
            </div>
            <span className={`text-xs px-2 py-1 rounded ${
              phase.status === 'Active' ? 'bg-emerald-900 text-emerald-300' : 'bg-gray-800 text-gray-400'
            }`}>
              {phase.status}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-8 bg-gray-900 rounded-lg p-4 border border-gray-800">
        <h2 className="text-lg font-semibold mb-3">Hardware</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div><span className="text-gray-500">Antenna:</span> DirecTV Slimline 5 (51x61 cm)</div>
          <div><span className="text-gray-500">LNA:</span> Nooelec SAWbird+ GOES</div>
          <div><span className="text-gray-500">SDR (RX):</span> RTL-SDR Blog V4</div>
          <div><span className="text-gray-500">SDR (TX):</span> ADALM-Pluto</div>
          <div><span className="text-gray-500">Total Cost:</span> ~$305</div>
        </div>
      </div>
    </div>
  )
}
