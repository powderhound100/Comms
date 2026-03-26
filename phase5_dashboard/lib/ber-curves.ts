import { berBpsk } from './link-budget'

export interface BERPoint {
  ebn0Db: number
  ber: number
}

export function theoreticalBpskUncoded(ebn0Range: number[]): BERPoint[] {
  return ebn0Range.map(e => ({ ebn0Db: e, ber: berBpsk(e) })).filter(p => p.ber > 0)
}

export function theoreticalBpskCoded(ebn0Range: number[], codingGainDb = 5.0): BERPoint[] {
  return ebn0Range.map(e => ({
    ebn0Db: e,
    ber: berBpsk(e + codingGainDb),
  })).filter(p => p.ber > 0)
}

export function generateEbn0Range(min = 0, max = 14, step = 0.5): number[] {
  const range: number[] = []
  for (let e = min; e <= max; e += step) range.push(e)
  return range
}
