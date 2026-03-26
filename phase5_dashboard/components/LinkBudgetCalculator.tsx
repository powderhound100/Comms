'use client'

import { useState } from 'react'
import { computeLinkBudget } from '@/lib/link-budget'
import { slantRange } from '@/lib/link-budget'
import type { LinkBudgetInput, LinkBudgetResult } from '@/lib/types'

const PRESETS: Record<string, Partial<LinkBudgetInput>> = {
  'GOES-18 LRIT': {
    txPowerDbw: 42, txAntennaGainDbi: 0, txLossDb: 0,
    freqHz: 1694.1e6, distanceKm: 38126,
    rxAntennaGainDbi: 12.5, systemNoiseTempK: 105,
    modulationType: 'bpsk', codeRate: 0.5, symbolRateSps: 293000,
    implementationLossDb: 2, pointingLossDb: 1, atmosphericLossDb: 0.5, rainMarginDb: 3,
  },
  'LEO S-band TT&C': {
    txPowerDbw: 35, txAntennaGainDbi: 0, txLossDb: 0,
    freqHz: 2200e6, distanceKm: 2500,
    rxAntennaGainDbi: 15, systemNoiseTempK: 105,
    modulationType: 'bpsk', codeRate: 0.5, symbolRateSps: 256000,
    implementationLossDb: 2, pointingLossDb: 1, atmosphericLossDb: 0.3, rainMarginDb: 1,
  },
}

export default function LinkBudgetCalculator() {
  const [input, setInput] = useState<LinkBudgetInput>({
    txPowerDbw: 42, txAntennaGainDbi: 0, txLossDb: 0,
    freqHz: 1694.1e6, distanceKm: 38126,
    rxAntennaGainDbi: 12.5, systemNoiseTempK: 105,
    modulationType: 'bpsk', codeRate: 0.5, symbolRateSps: 293000,
    implementationLossDb: 2, pointingLossDb: 1, atmosphericLossDb: 0.5, rainMarginDb: 3,
  })

  const result = computeLinkBudget(input)

  const update = (key: keyof LinkBudgetInput, value: number | string) => {
    setInput(prev => ({ ...prev, [key]: value }))
  }

  const applyPreset = (name: string) => {
    const preset = PRESETS[name]
    if (preset) setInput(prev => ({ ...prev, ...preset } as LinkBudgetInput))
  }

  const marginColor = result.linkMarginDb >= 3 ? 'text-emerald-400' :
    result.linkMarginDb >= 0 ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <div className="flex gap-2 mb-4">
          {Object.keys(PRESETS).map(name => (
            <button key={name} onClick={() => applyPreset(name)}
              className="text-xs px-3 py-1 bg-gray-800 rounded hover:bg-gray-700 transition-colors">
              {name}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <Field label="EIRP / TX Power (dBW)" value={input.txPowerDbw}
            onChange={v => update('txPowerDbw', v)} min={-10} max={60} />
          <Field label="Frequency (MHz)" value={input.freqHz / 1e6}
            onChange={v => update('freqHz', v * 1e6)} min={100} max={30000} />
          <Field label="Distance (km)" value={input.distanceKm}
            onChange={v => update('distanceKm', v)} min={100} max={50000} />
          <Field label="RX Antenna Gain (dBi)" value={input.rxAntennaGainDbi}
            onChange={v => update('rxAntennaGainDbi', v)} min={0} max={50} />
          <Field label="System Noise Temp (K)" value={input.systemNoiseTempK}
            onChange={v => update('systemNoiseTempK', v)} min={10} max={5000} />
          <Field label="Symbol Rate (ksps)" value={input.symbolRateSps / 1000}
            onChange={v => update('symbolRateSps', v * 1000)} min={1} max={10000} />
          <Field label="Code Rate" value={input.codeRate}
            onChange={v => update('codeRate', v)} min={0.1} max={1} step={0.05} />
          <Field label="Implementation Loss (dB)" value={input.implementationLossDb}
            onChange={v => update('implementationLossDb', v)} min={0} max={10} step={0.5} />
          <Field label="Rain Margin (dB)" value={input.rainMarginDb}
            onChange={v => update('rainMarginDb', v)} min={0} max={10} step={0.5} />
        </div>
      </div>

      <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Link Budget Results</h3>
        <div className="space-y-2 font-mono text-sm">
          <Row label="EIRP" value={result.eirpDbw} unit="dBW" />
          <Row label="Free Space Path Loss" value={-result.fsplDb} unit="dB" />
          <Row label="Atmospheric Loss" value={-input.atmosphericLossDb} unit="dB" />
          <Row label="Pointing Loss" value={-input.pointingLossDb} unit="dB" />
          <div className="border-t border-gray-800 my-2" />
          <Row label="RX Antenna Gain" value={input.rxAntennaGainDbi} unit="dBi" />
          <Row label="G/T" value={result.gOverTDbk} unit="dB/K" />
          <div className="border-t border-gray-800 my-2" />
          <Row label="C/N₀" value={result.cn0Dbhz} unit="dB-Hz" />
          <Row label="Eb/N₀ (available)" value={result.ebn0AvailableDb} unit="dB" />
          <Row label="Eb/N₀ (required)" value={result.ebn0RequiredDb} unit="dB" />
          <Row label="Implementation Loss" value={-input.implementationLossDb} unit="dB" />
          <Row label="Rain Margin" value={-input.rainMarginDb} unit="dB" />
          <div className="border-t border-gray-700 my-2" />
          <div className="flex justify-between text-lg font-bold">
            <span>Link Margin</span>
            <span className={marginColor}>{result.linkMarginDb > 0 ? '+' : ''}{result.linkMarginDb.toFixed(1)} dB</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, min, max, step = 1 }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-sm text-gray-400 w-48">{label}</label>
      <input type="number" value={value} step={step}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 w-28 text-sm" />
    </div>
  )
}

function Row({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}</span>
      <span>{value > 0 ? '+' : ''}{value.toFixed(2)} {unit}</span>
    </div>
  )
}
