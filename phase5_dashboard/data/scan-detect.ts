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
  protocol: string | null
  decoded_summary: string | null
  decoded_data: Record<string, unknown> | null
}

export interface TrackedAircraft {
  icao_hex: string
  callsign: string | null
  latitude: number | null
  longitude: number | null
  altitude_ft: number | null
  ground_speed_kt: number | null
  heading_deg: number | null
  vertical_rate_fpm: number | null
  squawk: string | null
  on_ground: boolean
}

export interface SatelliteJob {
  satellite: string
  pipeline: string
  iq_file: string
  output_dir: string
  status: string
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
  // Voice & Broadcast
  { name: 'FM Broadcast', startMhz: 87.5, stopMhz: 108, description: 'Commercial FM radio stations' },
  { name: 'VHF Aviation', startMhz: 118, stopMhz: 137, description: 'Aviation voice (AM) & ACARS' },
  { name: 'NOAA Weather', startMhz: 162, stopMhz: 163, description: 'NOAA Weather Radio + EAS alerts' },
  { name: '2m Amateur', startMhz: 144, stopMhz: 148, description: 'VHF amateur radio / APRS' },

  // Emergency & Public Safety
  { name: 'Public Safety VHF', startMhz: 150, stopMhz: 162, description: 'State patrol, MURS, pagers' },
  { name: 'Public Safety UHF', startMhz: 460, stopMhz: 470, description: 'Police, fire, EMS dispatch (NFM)' },
  { name: 'Marine VHF', startMhz: 156, stopMhz: 162.5, description: 'Marine Ch16 + AIS ship tracking' },
  { name: 'P25 Trunking', startMhz: 851, stopMhz: 869, description: 'P25 digital public safety trunked' },

  // Aircraft & Satellite
  { name: 'ADS-B', startMhz: 1088, stopMhz: 1092, description: 'Aircraft transponder (1090 MHz)' },
  { name: 'NOAA/Meteor Sat', startMhz: 137, stopMhz: 138, description: 'Weather satellite APT/LRPT' },
  { name: 'GOES LRIT', startMhz: 1693, stopMhz: 1695, description: 'GOES-16/18 LRIT downlink' },

  // ISM & Other
  { name: 'ISM 433', startMhz: 433, stopMhz: 434, description: 'ISM band — remotes, sensors, LoRa' },
  { name: 'FRS/GMRS', startMhz: 462, stopMhz: 467.7, description: 'Family Radio / GMRS walkie-talkies' },
  { name: 'Railroad', startMhz: 160, stopMhz: 162, description: 'AAR railroad operations' },
]

// Demo detections for initial render before scanner is connected
export const demoDetections: ScanDetection[] = [
  {
    id: 1,
    detected_at: '2026-03-24T14:32:01Z',
    frequency_hz: 1090000000,
    bandwidth_hz: 2000000,
    snr_db: 22.3,
    modulation: null,
    confidence: null,
    model_used: null,
    inference_ms: null,
    known_signal: 'ADS-B',
    demod_type: 'bits',
    demod_preview: '8D4840D6202CC371C32CE0576098',
    protocol: 'adsb',
    decoded_summary: '3 ADS-B msgs | ICAO 4840D6 (UAL1532) @ 40.6892,-73.8591 FL350',
    decoded_data: { messages_decoded: 3, aircraft_tracked: 1, positions: [{ icao: '4840D6', callsign: 'UAL1532', lat: 40.6892, lon: -73.8591, alt_ft: 35000, speed_kt: 452.3, heading: 245.1 }] },
  },
  {
    id: 2,
    detected_at: '2026-03-24T14:31:45Z',
    frequency_hz: 137620000,
    bandwidth_hz: 40000,
    snr_db: 18.7,
    modulation: 'AM-DSB',
    confidence: 0.89,
    model_used: 'vtcnn2',
    inference_ms: 3.1,
    known_signal: 'NOAA APT',
    demod_type: 'audio',
    demod_preview: 'FM audio: 48000 samples @ 48000 Hz',
    protocol: 'satellite_apt',
    decoded_summary: 'NOAA-19 APT captured: NOAA-19_APT_20260324_143145.raw (12.4 MB) → 3 images decoded',
    decoded_data: { satellite: 'NOAA-19', capture_type: 'APT', file_size_mb: 12.4, decoded_files: ['channel_a.png', 'channel_b.png', 'composite.png'] },
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
    protocol: 'aprs',
    decoded_summary: 'APRS: W3ADO-1 @ 39.9526,-75.1635 — Philly APRS Digi',
    decoded_data: { packets_decoded: 1, positions: [{ callsign: 'W3ADO-1', latitude: 39.9526, longitude: -75.1635, comment: 'Philly APRS Digi' }] },
  },
  {
    id: 4,
    detected_at: '2026-03-24T14:30:58Z',
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
    protocol: null,
    decoded_summary: null,
    decoded_data: null,
  },
  {
    id: 5,
    detected_at: '2026-03-24T14:30:30Z',
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
    protocol: null,
    decoded_summary: null,
    decoded_data: null,
  },
]

// Demo aircraft table
export const demoAircraft: TrackedAircraft[] = [
  { icao_hex: '4840D6', callsign: 'UAL1532', latitude: 40.6892, longitude: -73.8591, altitude_ft: 35000, ground_speed_kt: 452.3, heading_deg: 245.1, vertical_rate_fpm: 0, squawk: null, on_ground: false },
  { icao_hex: 'A12BC3', callsign: 'DAL872', latitude: 40.7128, longitude: -74.0060, altitude_ft: 28000, ground_speed_kt: 380.5, heading_deg: 180.0, vertical_rate_fpm: -1200, squawk: null, on_ground: false },
  { icao_hex: '3C6745', callsign: 'DLH456', latitude: 40.6413, longitude: -73.7781, altitude_ft: 5200, ground_speed_kt: 165.0, heading_deg: 45.3, vertical_rate_fpm: -800, squawk: null, on_ground: false },
]
