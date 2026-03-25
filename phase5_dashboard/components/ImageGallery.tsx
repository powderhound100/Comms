'use client'

import { useState, useMemo } from 'react'
import { SatelliteImagery } from '@/lib/types'
import ImageCard from './ImageCard'
import ImageViewer from './ImageViewer'

interface ImageGalleryProps {
  images: SatelliteImagery[]
}

export default function ImageGallery({ images }: ImageGalleryProps) {
  const [selectedSatellite, setSelectedSatellite] = useState<string>('all')
  const [selectedChannel, setSelectedChannel] = useState<string>('all')
  const [viewerImage, setViewerImage] = useState<SatelliteImagery | null>(null)

  const satellites = useMemo(
    () => Array.from(new Set(images.map(img => img.satellite))),
    [images]
  )

  const channelTypes = useMemo(
    () => Array.from(new Set(images.flatMap(img => img.channels.map(ch => ch.type)))),
    [images]
  )

  const filtered = useMemo(() => {
    let result = [...images]
    if (selectedSatellite !== 'all') {
      result = result.filter(img => img.satellite === selectedSatellite)
    }
    if (selectedChannel !== 'all') {
      result = result.filter(img => img.channels.some(ch => ch.type === selectedChannel))
    }
    return result.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())
  }, [images, selectedSatellite, selectedChannel])

  const currentIndex = viewerImage ? filtered.findIndex(img => img.id === viewerImage.id) : -1

  return (
    <div>
      {/* Filter Bar */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Satellite:</label>
          <select
            value={selectedSatellite}
            onChange={e => setSelectedSatellite(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-gray-500"
          >
            <option value="all">All</option>
            {satellites.map(sat => (
              <option key={sat} value={sat}>{sat}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Channel:</label>
          <select
            value={selectedChannel}
            onChange={e => setSelectedChannel(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-gray-500"
          >
            <option value="all">All</option>
            {channelTypes.map(ch => (
              <option key={ch} value={ch}>{ch}</option>
            ))}
          </select>
        </div>
        <span className="text-xs text-gray-500 ml-auto">{filtered.length} image{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(img => (
          <ImageCard key={img.id} image={img} onClick={() => setViewerImage(img)} />
        ))}
      </div>

      {/* Viewer Modal */}
      {viewerImage && (
        <ImageViewer
          image={viewerImage}
          onClose={() => setViewerImage(null)}
          onPrev={currentIndex > 0 ? () => setViewerImage(filtered[currentIndex - 1]) : undefined}
          onNext={currentIndex < filtered.length - 1 ? () => setViewerImage(filtered[currentIndex + 1]) : undefined}
        />
      )}
    </div>
  )
}
