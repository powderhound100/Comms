'use client'

import type { SdrMode } from '@/hooks/use-sdr'

const MODE_LABELS: Record<SdrMode, string> = {
  radio: 'Radio Receiver',
  scanner: 'Broadband Scanner',
  adsb: 'ADS-B Decoder',
  adsb_dual: 'ADS-B Dual (Pi)',
}

const MODE_PAGES: Record<SdrMode, string> = {
  radio: '/radio',
  scanner: '/scan-detect',
  adsb: '/ads-b',
  adsb_dual: '/ads-b',
}

interface SdrModeBarProps {
  myMode: SdrMode
  isMyMode: boolean
  isOtherMode: boolean
  activeMode: SdrMode | null
  loading: boolean
  pid: number | null
  uptime: number
  log: string[]
  onStart: () => void
  onStop: () => void
  /** Extra controls rendered inline (e.g. gain, test mode) */
  children?: React.ReactNode
}

export default function SdrModeBar({
  myMode, isMyMode, isOtherMode, activeMode, loading, pid, uptime, log,
  onStart, onStop, children,
}: SdrModeBarProps) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 mb-6 p-4">
      <div className="flex flex-wrap items-center gap-4">
        {/* Start / Stop */}
        <button
          onClick={isMyMode ? onStop : onStart}
          disabled={loading}
          className={`px-5 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
            loading
              ? 'bg-gray-700 text-gray-400 cursor-wait'
              : isMyMode
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
          }`}
        >
          {loading
            ? (isMyMode ? 'Stopping...' : 'Starting...')
            : isMyMode
              ? `Stop ${MODE_LABELS[myMode]}`
              : `Start ${MODE_LABELS[myMode]}`}
        </button>

        {/* Status dot */}
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${
            isMyMode ? 'bg-emerald-400 animate-pulse'
              : isOtherMode ? 'bg-amber-400'
              : 'bg-gray-600'
          }`} />
          <span className="text-sm text-gray-300">
            {isMyMode ? 'Active' : isOtherMode
              ? <>
                  <a href={MODE_PAGES[activeMode!]} className="text-amber-400 hover:underline">
                    {MODE_LABELS[activeMode!]}
                  </a>
                  {' '}is using the SDR — will auto-stop on start
                </>
              : 'SDR idle'}
          </span>
        </div>

        {/* Inline children (mode-specific controls) */}
        {children}

        {/* PID / uptime */}
        {isMyMode && pid && (
          <div className="text-xs text-gray-500 font-mono ml-auto">
            PID {pid} &middot; {Math.floor(uptime / 60)}m {uptime % 60}s
          </div>
        )}
      </div>

      {/* Log (collapsed by default, shown when there's an error or expanded) */}
      {log.length > 0 && isMyMode && (
        <details className="mt-3">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">
            Process log ({log.length} lines)
          </summary>
          <div className="mt-1 bg-gray-950 rounded-lg border border-gray-800 p-3 max-h-40 overflow-y-auto">
            {log.map((line, i) => (
              <div key={i} className="text-[11px] font-mono text-gray-400 leading-relaxed">{line}</div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
