// Static data and types for the Scan & Detect page

export interface ScanDetection {
  id: number
  detected_at: string
  frequency_hz: number
  bandwidth_hz: number
  snr_db: number
  modulation: string | null
  confidence: number | null
  model_used: string | null
  inference_ms: number | null
  known_signal: string | null
  demod_type: string | null
  demod_preview: string | null
}

export interface ScanSession {
  scan_id: string
  started_at: string
  stopped_at: string | null
  status: string
}

export interface ScannerStatus {
  running: boolean
  scan_id: string | null
  current_freq_hz: number
  total_detections: number
}

import type { SignalChain } from './gnu-radio'

export const scanPipelineChain: SignalChain = {
  name: 'Scan & Detect Pipeline',
  description: 'Broadband SDR sweep with real-time detection, AMR classification, demodulation, and logging.',
  phase: 7,
  planned: false,
  blocks: [
    { label: 'RTL-SDR', type: 'hardware' },
    { label: 'IQ Capture', type: 'dsp' },
    { label: 'FFT/PSD', type: 'dsp' },
    { label: 'Energy Detect', type: 'dsp' },
    { label: 'AMR Classify', type: 'ml' },
    { label: 'Demodulate', type: 'decode' },
    { label: 'Log & Stream', type: 'app' },
  ],
}

export const defaultScanBands = [
  { name: 'FM Broadcast', startMhz: 87.5, stopMhz: 108, description: 'Commercial FM radio stations' },
  { name: 'VHF Aviation', startMhz: 118, stopMhz: 137, description: 'Aviation voice & navigation' },
  { name: 'NOAA Weather', startMhz: 162, stopMhz: 163, description: 'NOAA Weather Radio (NWR)' },
  { name: '2m Amateur', startMhz: 144, stopMhz: 148, description: 'VHF amateur radio band' },
  { name: 'NOAA/Meteor Sat', startMhz: 137, stopMhz: 138, description: 'Weather satellite APT/LRPT' },
  { name: 'ADS-B', startMhz: 1088, stopMhz: 1092, description: 'Aircraft transponder (1090 MHz)' },
  { name: 'GOES LRIT', startMhz: 1693, stopMhz: 1695, description: 'GOES-16/18 LRIT downlink' },
  { name: 'ISM 433', startMhz: 433, stopMhz: 434, description: 'ISM band — remotes, sensors, LoRa' },
]

// Demo detections for initial render before scanner is connected
export const demoDetections: ScanDetection[] = [
  {
    id: 1,
    detected_at: '2026-03-24T14:32:01Z',
    frequency_hz: 162475000,
    bandwidth_hz: 25000,
    snr_db: 28.4,
    modulation: 'WBFM',
    confidence: 0.94,
    model_used: 'vtcnn2',
    inference_ms: 3.2,
    known_signal: 'NOAA Weather',
    demod_type: 'audio',
    demod_preview: 'FM audio: 48000 samples @ 48000 Hz',
  },
  {
    id: 2,
    detected_at: '2026-03-24T14:31:45Z',
    frequency_hz: 98100000,
    bandwidth_hz: 200000,
    snr_db: 35.1,
    modulation: 'WBFM',
    confidence: 0.97,
    model_used: 'vtcnn2',
    inference_ms: 2.8,
    known_signal: 'FM Broadcast',
    demod_type: 'audio',
    demod_preview: 'FM audio: 96000 samples @ 48000 Hz',
  },
  {
    id: 3,
    detected_at: '2026-03-24T14:31:12Z',
    frequency_hz: 144390000,
    bandwidth_hz: 15000,
    snr_db: 12.7,
    modulation: 'BPSK',
    confidence: 0.78,
    model_used: 'vtcnn2',
    inference_ms: 3.5,
    known_signal: '2m APRS',
    demod_type: 'bits',
    demod_preview: 'BPSK bits: a4f2c8e1... (128 bytes)',
  },
  {
    id: 4,
    detected_at: '2026-03-24T14:30:58Z',
    frequency_hz: 121500000,
    bandwidth_hz: 25000,
    snr_db: 8.2,
    modulation: 'AM-DSB',
    confidence: 0.82,
    model_used: 'vtcnn2',
    inference_ms: 3.1,
    known_signal: 'Aviation Voice',
    demod_type: 'audio',
    demod_preview: 'AM audio: 24000 samples @ 48000 Hz',
  },
  {
    id: 5,
    detected_at: '2026-03-24T14:30:30Z',
    frequency_hz: 433920000,
    bandwidth_hz: 50000,
    snr_db: 6.1,
    modulation: 'GFSK',
    confidence: 0.61,
    model_used: 'vtcnn2',
    inference_ms: 4.0,
    known_signal: 'ISM 433',
    demod_type: null,
    demod_preview: null,
  },
]
