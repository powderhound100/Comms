import BERCurvePlot from '@/components/BERCurvePlot'

export default function ModemPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">BER & Constellation Viewer</h1>
      <p className="text-gray-400 mb-6">
        Phase 3 simulation results and Phase 4 OTA measurements overlaid with theoretical curves.
      </p>
      <BERCurvePlot />

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">BPSK Uncoded @ 10⁻⁵</div>
          <div className="text-xl font-bold text-blue-400">9.6 dB</div>
          <div className="text-sm text-gray-500">Required Eb/N₀</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Coding Gain (r=1/2 Viterbi)</div>
          <div className="text-xl font-bold text-emerald-400">~5.0 dB</div>
          <div className="text-sm text-gray-500">@ BER 10⁻⁵</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Implementation Loss (OTA)</div>
          <div className="text-xl font-bold text-amber-400">&lt; 1.5 dB</div>
          <div className="text-sm text-gray-500">Sim vs OTA</div>
        </div>
      </div>
    </div>
  )
}
