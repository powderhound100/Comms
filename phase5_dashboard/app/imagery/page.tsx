import {
  satelliteProfiles,
  satdumpPipelines,
  sampleImagery,
  decodingWorkflow,
  imageryChain,
} from '@/data/satellite-imagery'
import SignalFlowDiagram from '@/components/SignalFlowDiagram'
import ImageGallery from '@/components/ImageGallery'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-gray-800/50">
      <td className="py-1.5 text-gray-400 w-48">{label}</td>
      <td className="py-1.5 font-mono">{value}</td>
    </tr>
  )
}

const satelliteColor: Record<string, string> = {
  'GOES-18': 'bg-sky-900/50 border-sky-700 text-sky-300',
  'Meteor-M2-3': 'bg-violet-900/50 border-violet-700 text-violet-300',
  'NOAA-19': 'bg-amber-900/50 border-amber-700 text-amber-300',
}

export default function ImageryPage() {
  const completedImages = sampleImagery.filter(img => img.decodeStatus === 'complete')
  const satellites = new Set(sampleImagery.map(img => img.satellite))
  const bestQuality = sampleImagery.reduce((best, img) =>
    img.signalQuality.snrDb > best.signalQuality.snrDb ? img : best
  )

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Satellite Imagery</h1>
        <p className="text-gray-400">
          Weather satellite image reception, SatDump decoding pipelines, and decoded imagery gallery
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Images Received</div>
          <div className="text-2xl font-bold text-sky-400">{completedImages.length}</div>
          <div className="text-sm text-gray-500">Decoded satellite images</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Satellites Tracked</div>
          <div className="text-2xl font-bold text-sky-400">{satellites.size}</div>
          <div className="text-sm text-gray-500">GOES-18, Meteor-M2, NOAA-19</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-500">Best Signal Quality</div>
          <div className="text-2xl font-bold text-sky-400">{bestQuality.signalQuality.snrDb} dB</div>
          <div className="text-sm text-gray-500">SNR — {bestQuality.satellite}</div>
        </div>
      </div>

      {/* Signal Flow Diagram */}
      <h2 className="text-xl font-semibold mb-4">Imagery Signal Chain</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8">
        <SignalFlowDiagram chain={imageryChain} />
      </div>

      {/* Satellite Profiles */}
      <h2 className="text-xl font-semibold mb-4">Satellite Profiles</h2>
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 mb-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-left text-gray-400">
              <th className="py-2 pr-4">Satellite</th>
              <th className="py-2 pr-4">Frequency</th>
              <th className="py-2 pr-4">Modulation</th>
              <th className="py-2 pr-4">Data Rate</th>
              <th className="py-2 pr-4">Type</th>
              <th className="py-2">Antenna</th>
            </tr>
          </thead>
          <tbody>
            {satelliteProfiles.map(sat => (
              <tr key={sat.name} className="border-b border-gray-800/50">
                <td className="py-1.5 pr-4 font-medium">{sat.name}</td>
                <td className="py-1.5 pr-4 font-mono text-gray-300">{sat.frequency}</td>
                <td className="py-1.5 pr-4 text-gray-300">{sat.modulation}</td>
                <td className="py-1.5 pr-4 font-mono text-gray-400">{sat.dataRate}</td>
                <td className="py-1.5 pr-4">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${satelliteColor[sat.name] || 'bg-gray-800 border-gray-600 text-gray-400'}`}>
                    {sat.captureType}
                  </span>
                </td>
                <td className="py-1.5 text-gray-400">{sat.antenna}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Satellite Descriptions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {satelliteProfiles.map(sat => (
          <div key={sat.name} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-semibold">{sat.name}</h3>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${satelliteColor[sat.name] || 'bg-gray-800 border-gray-600 text-gray-400'}`}>
                {sat.captureType}
              </span>
            </div>
            <p className="text-sm text-gray-400 mb-3">{sat.description}</p>
            <table className="w-full text-sm">
              <tbody>
                <Row label="LNA" value={sat.lna} />
                <Row label="NORAD ID" value={String(sat.noradId)} />
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* SatDump Pipelines */}
      <h2 className="text-xl font-semibold mb-4">SatDump Pipelines</h2>
      <div className="space-y-4 mb-8">
        {satdumpPipelines.map(pipeline => (
          <div key={pipeline.satellite} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <h3 className="font-semibold mb-1">{pipeline.satellite}</h3>
            <div className="text-xs text-gray-500 mb-3">
              Pipeline: <code className="bg-gray-800 px-1.5 py-0.5 rounded">{pipeline.pipelineName}</code>
            </div>
            <table className="w-full text-sm mb-3">
              <tbody>
                <Row label="Input Format" value={pipeline.inputFormat} />
                <Row label="Sample Rate" value={`${(pipeline.sampleRate / 1e6).toFixed(1)} Msps`} />
                <Row label="Frequency" value={`${(pipeline.frequency / 1e6).toFixed(1)} MHz`} />
                <Row label="Output Products" value={pipeline.outputProducts.join(', ')} />
              </tbody>
            </table>
            <div className="bg-gray-950 rounded p-3 text-xs font-mono text-gray-400">
              <span className="text-emerald-400">$</span> satdump {pipeline.pipelineName} baseband input.raw ./output --samplerate {pipeline.sampleRate}
            </div>
          </div>
        ))}
      </div>

      {/* Decoding Workflow */}
      <h2 className="text-xl font-semibold mb-4">Decoding Workflow</h2>
      <div className="space-y-2 mb-8">
        {decodingWorkflow.map(step => (
          <div key={step.step} className="bg-gray-900 rounded-lg p-4 border border-gray-800 flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-sky-900/60 border border-sky-700 flex items-center justify-center text-sm font-bold text-sky-300">
              {step.step}
            </div>
            <div className="flex-1">
              <div className="font-medium">{step.name}</div>
              <div className="text-sm text-gray-500">{step.description}</div>
            </div>
            <code className="text-xs bg-gray-800 px-2 py-1 rounded text-gray-400">{step.script}</code>
            {step.automated ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-900/50 border-emerald-700 text-emerald-300">
                Automated
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-900/50 border-amber-700 text-amber-300">
                Manual
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Image Gallery */}
      <h2 className="text-xl font-semibold mb-4">Image Gallery</h2>
      <div className="mb-8">
        <ImageGallery images={sampleImagery} />
      </div>
    </div>
  )
}
