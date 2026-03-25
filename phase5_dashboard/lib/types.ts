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

// ── Satellite Imagery ──

export interface ImageChannel {
  name: string
  type: 'visible' | 'infrared' | 'composite' | 'enhanced'
  path: string
  resolution: string
}

export interface SignalQuality {
  snrDb: number
  cn0Dbhz: number
  lockPercentage: number
  viterbiBer: number
  rsErrors: number
}

export interface SatelliteImagery {
  id: string
  satellite: string
  captureType: 'LRIT' | 'LRPT' | 'APT'
  capturedAt: string
  imagePaths: string[]
  thumbnailPath: string
  channels: ImageChannel[]
  decodeStatus: 'pending' | 'decoding' | 'complete' | 'failed'
  signalQuality: SignalQuality
}

export interface SatDumpConfig {
  satellite: string
  pipelineName: string
  inputFormat: string
  sampleRate: number
  frequency: number
  outputProducts: string[]
}

// ── Signal Monitor ──

export interface ClassificationResult {
  timestamp: string
  frequencyMhz: number
  bandwidthKhz: number
  modulationType: string
  confidence: number
  snrDb: number
  modelUsed: string
  inferenceTimeMs: number
}
