export interface LinkBudgetInput {
  txPowerDbw: number
  txAntennaGainDbi: number
  txLossDb: number
  freqHz: number
  distanceKm: number
  rxAntennaGainDbi: number
  systemNoiseTempK: number
  modulationType: 'bpsk' | 'qpsk' | '8psk'
  codeRate: number
  symbolRateSps: number
  implementationLossDb: number
  pointingLossDb: number
  atmosphericLossDb: number
  rainMarginDb: number
}

export interface LinkBudgetResult {
  eirpDbw: number
  fsplDb: number
  receivedPowerDbw: number
  gOverTDbk: number
  cn0Dbhz: number
  ebn0AvailableDb: number
  ebn0RequiredDb: number
  linkMarginDb: number
}

export interface WaterfallItem {
  label: string
  value: number
  cumulative: number
  type: 'gain' | 'loss'
}

export interface SessionLog {
  sessionId: string
  datetimeUtc: string
  satellite: string
  freqMhz: number
  durationSec: number
  elevationDeg: number
  predictedCn0Dbhz: number
  measuredCn0Dbhz: number
  deltaDb: number
  decodedOk: boolean
  notes: string
}

export interface BERResult {
  ebn0Db: number
  ber: number
  modulation: string
  coding: string
  channel: string
}

export interface SatellitePass {
  satellite: string
  aos: string
  los: string
  maxElevationDeg: number
  durationSec: number
  predictedCn0Dbhz: number
}
