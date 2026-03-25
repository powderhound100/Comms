'use client'

import { useState, useEffect, useCallback } from 'react'
import { SatelliteImagery } from '@/lib/types'
import SignalQualityBadge from './SignalQualityBadge'

interface ImageViewerProps {
  image: SatelliteImagery
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
}

export default function ImageViewer({ image, onClose, onPrev, onNext }: ImageViewerProps) {
  const [selectedChannel, setSelectedChannel] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'ArrowLeft' && onPrev) onPrev()
    if (e.key === 'ArrowRight' && onNext) onNext()
  }, [onClose, onPrev, onNext])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Reset zoom/pan when image changes
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setSelectedChannel(0)
  }, [image.id])

  const channel = image.channels[selectedChannel]

  return (
    <div className="fixed inset-0 z-50 bg-gray-950/95 flex" onClick={onClose}>
      <div className="flex-1 flex items-center justify-center relative" onClick={e => e.stopPropagation()}>
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white text-xl z-10"
        >
          ✕
        </button>

        {/* Prev/Next */}
        {onPrev && (
          <button
            onClick={onPrev}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-2xl z-10"
          >
            ‹
          </button>
        )}
        {onNext && (
          <button
            onClick={onNext}
            className="absolute right-80 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-2xl z-10"
          >
            ›
          </button>
        )}

        {/* Image area */}
        <div
          className="w-full h-full flex items-center justify-center overflow-hidden cursor-grab"
          onWheel={e => {
            e.preventDefault()
            setZoom(prev => Math.max(0.5, Math.min(5, prev + (e.deltaY > 0 ? -0.1 : 0.1))))
          }}
          onMouseDown={e => {
            if (zoom <= 1) return
            const startX = e.clientX - pan.x
            const startY = e.clientY - pan.y
            const onMove = (ev: MouseEvent) => setPan({ x: ev.clientX - startX, y: ev.clientY - startY })
            const onUp = () => {
              document.removeEventListener('mousemove', onMove)
              document.removeEventListener('mouseup', onUp)
            }
            document.addEventListener('mousemove', onMove)
            document.addEventListener('mouseup', onUp)
          }}
        >
          <div
            className="bg-gray-800 rounded-lg flex items-center justify-center"
            style={{
              width: '600px',
              height: '400px',
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              transition: 'transform 0.1s ease-out',
            }}
          >
            <div className="text-center">
              <div className="text-5xl mb-2">🛰️</div>
              <div className="text-sm text-gray-500">{channel?.name || image.satellite}</div>
              <div className="text-xs text-gray-600 mt-1">{channel?.resolution || ''} resolution</div>
            </div>
          </div>
        </div>
      </div>

      {/* Metadata sidebar */}
      <div
        className="w-72 bg-gray-900 border-l border-gray-800 p-4 overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="font-semibold mb-4">{image.satellite}</h3>

        <div className="space-y-3 text-sm">
          <div>
            <div className="text-xs text-gray-500 mb-1">Capture Type</div>
            <div className="font-mono">{image.captureType}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Captured At</div>
            <div className="font-mono text-xs">{new Date(image.capturedAt).toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Signal Quality</div>
            <SignalQualityBadge quality={image.signalQuality} />
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">SNR</div>
            <div className="font-mono">{image.signalQuality.snrDb} dB</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">C/N₀</div>
            <div className="font-mono">{image.signalQuality.cn0Dbhz} dB-Hz</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Lock</div>
            <div className="font-mono">{image.signalQuality.lockPercentage}%</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Viterbi BER</div>
            <div className="font-mono">{image.signalQuality.viterbiBer.toExponential(1)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">RS Errors</div>
            <div className="font-mono">{image.signalQuality.rsErrors}</div>
          </div>
        </div>

        {/* Channel Switcher */}
        {image.channels.length > 0 && (
          <div className="mt-6">
            <div className="text-xs text-gray-500 mb-2">Channels</div>
            <div className="space-y-1">
              {image.channels.map((ch, i) => (
                <button
                  key={ch.name}
                  onClick={() => setSelectedChannel(i)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                    i === selectedChannel
                      ? 'bg-sky-900/50 border border-sky-700 text-sky-300'
                      : 'bg-gray-800 border border-gray-700 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  <div className="font-medium">{ch.name}</div>
                  <div className="text-gray-500">{ch.type} — {ch.resolution}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Zoom controls */}
        <div className="mt-6">
          <div className="text-xs text-gray-500 mb-2">Zoom</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setZoom(prev => Math.max(0.5, prev - 0.25))}
              className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-400 hover:border-gray-600"
            >
              −
            </button>
            <span className="text-xs font-mono text-gray-400">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom(prev => Math.min(5, prev + 0.25))}
              className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-400 hover:border-gray-600"
            >
              +
            </button>
            <button
              onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}
              className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-400 hover:border-gray-600 ml-auto"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
