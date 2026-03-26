import { SatelliteImagery } from '@/lib/types'
import SignalQualityBadge from './SignalQualityBadge'

const satelliteColor: Record<string, string> = {
  'GOES-18': 'bg-sky-900/50 border-sky-700 text-sky-300',
  'Meteor-M2-3': 'bg-violet-900/50 border-violet-700 text-violet-300',
  'NOAA-19': 'bg-amber-900/50 border-amber-700 text-amber-300',
}

const statusBadge: Record<string, string> = {
  complete: 'bg-emerald-900/50 border-emerald-700 text-emerald-300',
  decoding: 'bg-blue-900/50 border-blue-700 text-blue-300',
  pending: 'bg-amber-900/50 border-amber-700 text-amber-300',
  failed: 'bg-red-900/50 border-red-700 text-red-300',
}

interface ImageCardProps {
  image: SatelliteImagery
  onClick: () => void
}

export default function ImageCard({ image, onClick }: ImageCardProps) {
  return (
    <div
      className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden cursor-pointer hover:border-gray-600 transition-colors"
      onClick={onClick}
    >
      {/* Thumbnail area */}
      <div className="h-40 bg-gray-800 flex items-center justify-center relative">
        {image.decodeStatus === 'complete' ? (
          <div className="text-center">
            <div className="text-3xl mb-1">🛰️</div>
            <div className="text-xs text-gray-500">
              {image.channels.length} channel{image.channels.length !== 1 ? 's' : ''}
            </div>
          </div>
        ) : (
          <div className="text-xs text-gray-500">Awaiting decode</div>
        )}
        <div className="absolute top-2 right-2">
          <SignalQualityBadge quality={image.signalQuality} />
        </div>
      </div>

      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${satelliteColor[image.satellite] || 'bg-gray-800 border-gray-600 text-gray-400'}`}>
            {image.satellite}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${statusBadge[image.decodeStatus]}`}>
            {image.decodeStatus}
          </span>
        </div>
        <div className="text-xs text-gray-400 mb-1">
          {image.captureType} — {new Date(image.capturedAt).toLocaleString()}
        </div>
        {image.channels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {image.channels.map(ch => (
              <span key={ch.name} className="text-[9px] px-1 py-0.5 rounded bg-gray-800 text-gray-500">
                {ch.type}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
