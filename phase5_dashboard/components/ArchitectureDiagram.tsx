'use client'

import { useState } from 'react'
import { decoderPipeline, sdrSlots, dataFlowTiers } from '@/data/ads-b'
import type { DecoderStage } from '@/data/ads-b'

const typeColors: Record<string, string> = {
  hardware: 'bg-blue-900/60 border-blue-700 text-blue-300',
  dsp: 'bg-gray-800 border-gray-600 text-gray-300',
  decode: 'bg-cyan-900/60 border-cyan-700 text-cyan-300',
  app: 'bg-amber-900/60 border-amber-700 text-amber-300',
}

const typeLabels: Record<string, string> = {
  hardware: 'HW',
  dsp: 'DSP',
  decode: 'Decode',
  app: 'App',
}

// ── Pipeline Layout: vertical cascade of decoder stages ──

function PipelineLayout() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <div className="flex flex-col items-center gap-0">
      {decoderPipeline.map((stage: DecoderStage, i: number) => (
        <div key={stage.name} className="flex flex-col items-center w-full max-w-xl">
          {i > 0 && (
            <div className="text-gray-600 text-lg leading-none py-0.5">&darr;</div>
          )}
          <button
            onClick={() => toggle(stage.name)}
            className={`w-full text-left rounded-lg border px-3 py-2 transition-colors hover:brightness-110 ${typeColors[stage.type]}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/30 border border-white/10 shrink-0">
                  {typeLabels[stage.type]}
                </span>
                <span className="font-medium text-sm">{stage.name}</span>
              </div>
              <span className="text-[10px] text-gray-500 shrink-0">
                {expanded.has(stage.name) ? '▲' : '▼'}
              </span>
            </div>
            <p className="text-xs opacity-80 mt-1">{stage.description}</p>
            {expanded.has(stage.name) && (
              <p className="text-[11px] font-mono mt-1.5 pt-1.5 border-t border-white/10 opacity-70">
                {stage.detail}
              </p>
            )}
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Slot Map Layout: 3-column SDR dongle architecture ──

function SlotMapLayout() {
  const slotColors: Record<string, { bg: string; border: string; text: string; dot: string }> = {
    cyan: { bg: 'bg-cyan-900/40', border: 'border-cyan-700', text: 'text-cyan-300', dot: 'bg-cyan-400' },
    orange: { bg: 'bg-orange-900/40', border: 'border-orange-700', text: 'text-orange-300', dot: 'bg-orange-400' },
    emerald: { bg: 'bg-emerald-900/40', border: 'border-emerald-700', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        {/* Column headers */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 mb-4">
          <div className="text-xs font-semibold text-gray-400 text-center">SDR Dongles</div>
          <div className="text-xs font-semibold text-gray-400 text-center w-32">Streamers</div>
          <div className="text-xs font-semibold text-gray-400 text-center">Outputs</div>
        </div>

        {/* Slot 0 & 1 → merge → ADS-B WebSocket */}
        <div className="space-y-3 mb-4">
          {sdrSlots.filter(s => s.slot <= 1).map(slot => {
            const c = slotColors[slot.color]
            return (
              <div key={slot.slot} className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
                {/* Dongle card */}
                <div className={`${c.bg} ${c.border} border rounded-lg px-3 py-2`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${c.dot}`} />
                    <span className={`text-sm font-medium ${c.text}`}>{slot.label}</span>
                  </div>
                  <div className="text-[10px] font-mono text-gray-500 mt-0.5">{slot.serial}</div>
                </div>
                {/* Arrow + streamer */}
                <div className="flex items-center gap-1 w-32 justify-center">
                  <span className="text-gray-600">&rarr;</span>
                  <div className="text-[10px] font-mono text-gray-400 bg-gray-800 rounded px-1.5 py-0.5 border border-gray-700">
                    {slot.streamer}
                  </div>
                  <span className="text-gray-600">&rarr;</span>
                </div>
                {/* TCP output label */}
                <div className="text-[10px] font-mono text-gray-500 text-center">
                  TCP :{slot.port}
                </div>
              </div>
            )
          })}
        </div>

        {/* Merge box */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center mb-4">
          <div />
          <div className="w-32" />
          <div className="flex items-center justify-center">
            <div className="flex flex-col items-center">
              <div className="text-gray-600 text-sm">&darr; &darr;</div>
              <div className="bg-purple-900/40 border border-purple-700 rounded-lg px-3 py-2 text-center">
                <div className="text-sm font-medium text-purple-300">DualAdsbServer</div>
                <div className="text-[10px] font-mono text-gray-500">merge 1090 + 978</div>
              </div>
              <div className="text-gray-600 text-sm">&darr;</div>
              <div className="text-[10px] font-mono text-purple-400 bg-gray-800 rounded px-2 py-0.5 border border-gray-700">
                WS :8771
              </div>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-gray-800 my-4" />

        {/* Slot 2 → direct radio */}
        {sdrSlots.filter(s => s.slot === 2).map(slot => {
          const c = slotColors[slot.color]
          return (
            <div key={slot.slot} className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
              <div className={`${c.bg} ${c.border} border rounded-lg px-3 py-2`}>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${c.dot}`} />
                  <span className={`text-sm font-medium ${c.text}`}>{slot.label}</span>
                </div>
                <div className="text-[10px] font-mono text-gray-500 mt-0.5">{slot.serial}</div>
              </div>
              <div className="flex items-center gap-1 w-32 justify-center">
                <span className="text-gray-600">&rarr;</span>
                <div className="text-[10px] font-mono text-gray-400 bg-gray-800 rounded px-1.5 py-0.5 border border-gray-700">
                  {slot.streamer}
                </div>
                <span className="text-gray-600">&rarr;</span>
              </div>
              <div className="flex items-center justify-center">
                <div className="text-[10px] font-mono text-emerald-400 bg-gray-800 rounded px-2 py-0.5 border border-gray-700">
                  WS :{slot.port}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Tiered Layout: 3-tier data flow ──

const tierColors = [
  { bg: 'bg-blue-900/30', border: 'border-blue-800', header: 'text-blue-300', headerBg: 'bg-blue-900/50' },
  { bg: 'bg-purple-900/30', border: 'border-purple-800', header: 'text-purple-300', headerBg: 'bg-purple-900/50' },
  { bg: 'bg-amber-900/30', border: 'border-amber-800', header: 'text-amber-300', headerBg: 'bg-amber-900/50' },
]

const tierArrows = [
  { label: 'TCP binary frames', sublabel: ':9001 / :9002' },
  { label: 'WebSocket JSON', sublabel: ':8771' },
]

function TieredLayout() {
  return (
    <div className="overflow-x-auto">
      <div className="flex flex-col lg:flex-row gap-0 items-stretch min-w-0">
        {dataFlowTiers.map((tier, i) => {
          const c = tierColors[i]
          return (
            <div key={tier.tier} className="flex flex-col lg:flex-row items-stretch">
              {/* Tier column */}
              <div className={`${c.bg} ${c.border} border rounded-lg flex-1 min-w-[200px] lg:w-56`}>
                {/* Header */}
                <div className={`${c.headerBg} rounded-t-lg px-3 py-2 border-b ${c.border}`}>
                  <div className={`text-sm font-semibold ${c.header}`}>{tier.name}</div>
                  <div className="text-[10px] font-mono text-gray-500">{tier.host}:{tier.port}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{tier.role}</div>
                </div>
                {/* Process cards */}
                <div className="p-2 space-y-1.5">
                  {tier.processes.map(proc => (
                    <div key={proc.name} className="bg-gray-900 rounded border border-gray-800 px-2.5 py-1.5">
                      <div className="text-xs font-medium text-gray-200">{proc.name}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">{proc.detail}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Arrow between tiers */}
              {i < dataFlowTiers.length - 1 && (
                <div className="flex lg:flex-col items-center justify-center px-2 py-2 lg:py-0">
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[10px] font-mono text-gray-500">{tierArrows[i].label}</span>
                    <span className="text-gray-600 text-lg lg:rotate-0 rotate-90">&rarr;</span>
                    <span className="text-[10px] font-mono text-gray-600">{tierArrows[i].sublabel}</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main component ──

export default function ArchitectureDiagram({ layout }: { layout: 'pipeline' | 'slot-map' | 'tiered' }) {
  switch (layout) {
    case 'pipeline':
      return <PipelineLayout />
    case 'slot-map':
      return <SlotMapLayout />
    case 'tiered':
      return <TieredLayout />
  }
}
