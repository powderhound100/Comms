import { LinkBudgetInput, LinkBudgetResult, WaterfallItem } from './types'

const C = 299792458 // speed of light m/s
const K_DB = -228.6 // Boltzmann constant dBW/K/Hz

export function fspl(freqHz: number, distanceKm: number): number {
  const distanceM = distanceKm * 1000
  const wavelength = C / freqHz
  return 10 * Math.log10(Math.pow(4 * Math.PI * distanceM / wavelength, 2))
}

export function parabolicGain(diameterM: number, freqHz: number, efficiency = 0.55): number {
  const wavelength = C / freqHz
  const gainLinear = efficiency * Math.pow(Math.PI * diameterM / wavelength, 2)
  return 10 * Math.log10(gainLinear)
}

export function slantRange(altitudeKm: number, elevationDeg: number): number {
  const R = 6371
  const h = altitudeKm
  const theta = elevationDeg * Math.PI / 180
  return -R * Math.sin(theta) + Math.sqrt(
    Math.pow(R * Math.sin(theta), 2) + 2 * R * h + h * h
  )
}

export function berBpsk(ebn0Db: number): number {
  const ebn0Linear = Math.pow(10, ebn0Db / 10)
  return 0.5 * erfc(Math.sqrt(ebn0Linear))
}

function erfc(x: number): number {
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const sign = x < 0 ? -1 : 1
  x = Math.abs(x)
  const t = 1.0 / (1.0 + p * x)
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
  return 1 - sign * y
}

function requiredEbn0(targetBer: number, coded: boolean, codeRate = 0.5): number {
  let lo = -5, hi = 30
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    const ebn0Eff = coded ? mid + 5.0 : mid
    const ber = berBpsk(ebn0Eff)
    if (ber > targetBer) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export function computeLinkBudget(input: LinkBudgetInput): LinkBudgetResult {
  const eirpDbw = input.txPowerDbw + input.txAntennaGainDbi - input.txLossDb
  const fsplDb = fspl(input.freqHz, input.distanceKm)
  const gOverTDbk = input.rxAntennaGainDbi - 10 * Math.log10(input.systemNoiseTempK)

  const cn0Dbhz = eirpDbw - fsplDb - input.atmosphericLossDb - input.pointingLossDb +
    gOverTDbk - K_DB

  const bitsPerSymbol = input.modulationType === 'qpsk' ? 2 :
    input.modulationType === '8psk' ? 3 : 1
  const bitRate = input.symbolRateSps * bitsPerSymbol * input.codeRate
  const ebn0AvailableDb = cn0Dbhz - 10 * Math.log10(bitRate)

  const coded = input.codeRate < 1.0
  const ebn0RequiredDb = requiredEbn0(1e-5, coded, input.codeRate)

  const linkMarginDb = ebn0AvailableDb - ebn0RequiredDb -
    input.implementationLossDb - input.rainMarginDb

  const receivedPowerDbw = eirpDbw - fsplDb - input.atmosphericLossDb -
    input.pointingLossDb + input.rxAntennaGainDbi

  return {
    eirpDbw: Math.round(eirpDbw * 100) / 100,
    fsplDb: Math.round(fsplDb * 100) / 100,
    receivedPowerDbw: Math.round(receivedPowerDbw * 100) / 100,
    gOverTDbk: Math.round(gOverTDbk * 100) / 100,
    cn0Dbhz: Math.round(cn0Dbhz * 100) / 100,
    ebn0AvailableDb: Math.round(ebn0AvailableDb * 100) / 100,
    ebn0RequiredDb: Math.round(ebn0RequiredDb * 100) / 100,
    linkMarginDb: Math.round(linkMarginDb * 100) / 100,
  }
}

export function computeWaterfall(input: LinkBudgetInput): WaterfallItem[] {
  const result = computeLinkBudget(input)
  const items: WaterfallItem[] = []
  let cumulative = 0

  cumulative += result.eirpDbw
  items.push({ label: 'EIRP', value: result.eirpDbw, cumulative, type: 'gain' })

  cumulative -= result.fsplDb
  items.push({ label: 'FSPL', value: -result.fsplDb, cumulative, type: 'loss' })

  cumulative -= input.atmosphericLossDb
  items.push({ label: 'Atm Loss', value: -input.atmosphericLossDb, cumulative, type: 'loss' })

  cumulative -= input.pointingLossDb
  items.push({ label: 'Pointing', value: -input.pointingLossDb, cumulative, type: 'loss' })

  cumulative += input.rxAntennaGainDbi
  items.push({ label: 'RX Gain', value: input.rxAntennaGainDbi, cumulative, type: 'gain' })

  return items
}
