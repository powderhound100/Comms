import { SignalChain } from '../data/gnu-radio'

const typeColors: Record<string, string> = {
  hardware: 'bg-blue-900/60 border-blue-700 text-blue-300',
  dsp: 'bg-gray-800 border-gray-600 text-gray-300',
  ccsds: 'bg-emerald-900/60 border-emerald-700 text-emerald-300',
  app: 'bg-amber-900/60 border-amber-700 text-amber-300',
  attenuator: 'bg-red-900/60 border-red-700 text-red-300',
}

export default function SignalFlowDiagram({ chain }: { chain: SignalChain }) {
  return (
    <div className={chain.planned ? 'opacity-60' : ''}>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-lg font-semibold">{chain.name}</h3>
        {chain.planned && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-900/50 border-amber-700 text-amber-300">
            Planned
          </span>
        )}
      </div>
      <p className="text-sm text-gray-400 mb-3">{chain.description}</p>
      <div className="overflow-x-auto">
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          {chain.blocks.map((block, i) => (
            <div key={i} className="flex items-center gap-1">
              <div
                className={`px-3 py-1.5 rounded border text-xs font-medium whitespace-nowrap ${typeColors[block.type]}`}
              >
                {block.label}
              </div>
              {i < chain.blocks.length - 1 && (
                <span className="text-gray-600 text-sm">&rarr;</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
