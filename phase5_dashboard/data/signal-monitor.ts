// GROUNDLINK Signal Monitor — AI-Powered RF Signal Identification and Classification

import { SignalChain } from './gnu-radio'
import { ClassificationResult } from '@/lib/types'

export interface FrequencyBand {
  name: string
  rangeMhz: string
  knownSignals: string[]
  description: string
}

export interface KnownSignal {
  name: string
  frequencyMhz: number
  bandwidthKhz: number
  modulation: string
  dataRate: string
  source: string
  autoDecodable: boolean
}

export interface MLModel {
  name: string
  architecture: string
  inputShape: string
  accuracy: string
  dataset: string
  modulationsSupported: number
  inferenceTimeMs: number
  description: string
}

// ── Frequency Bands ──

export const frequencyBands: FrequencyBand[] = [
  {
    name: 'VHF',
    rangeMhz: '30–300 MHz',
    knownSignals: ['NOAA APT', 'Meteor LRPT', 'FM Broadcast', 'Aircraft VHF'],
    description: 'Very High Frequency — weather satellite downlinks, broadcast FM, aviation communications',
  },
  {
    name: 'UHF',
    rangeMhz: '300–1000 MHz',
    knownSignals: ['ADS-B (1090 ES)', 'ISM 433 MHz', 'ISM 915 MHz', 'LoRa'],
    description: 'Ultra High Frequency — ADS-B aircraft surveillance, ISM band IoT devices, amateur radio',
  },
  {
    name: 'L-band',
    rangeMhz: '1–2 GHz',
    knownSignals: ['GOES LRIT', 'Inmarsat', 'GPS L1', 'Iridium'],
    description: 'L-band — geostationary weather satellite downlinks, GNSS, mobile satellite services',
  },
  {
    name: 'S-band',
    rangeMhz: '2–4 GHz',
    knownSignals: ['Wi-Fi 2.4 GHz', 'Bluetooth', 'Weather Radar'],
    description: 'S-band — ISM 2.4 GHz devices, weather radar, some satellite uplinks',
  },
]

// ── Known Signals Catalog ──

export const knownSignals: KnownSignal[] = [
  {
    name: 'GOES-18 LRIT',
    frequencyMhz: 1694.1,
    bandwidthKhz: 600,
    modulation: 'BPSK',
    dataRate: '293,883 bps',
    source: 'GOES-18 (GEO)',
    autoDecodable: true,
  },
  {
    name: 'Meteor-M2 LRPT',
    frequencyMhz: 137.9,
    bandwidthKhz: 120,
    modulation: 'QPSK',
    dataRate: '72,000 bps',
    source: 'Meteor-M2-3 (LEO)',
    autoDecodable: true,
  },
  {
    name: 'NOAA APT',
    frequencyMhz: 137.1,
    bandwidthKhz: 34,
    modulation: 'AM/FM',
    dataRate: '2 lines/sec',
    source: 'NOAA-15/18/19 (LEO)',
    autoDecodable: true,
  },
  {
    name: 'ADS-B 1090ES',
    frequencyMhz: 1090.0,
    bandwidthKhz: 2000,
    modulation: 'PPM',
    dataRate: '1 Mbps',
    source: 'Aircraft transponders',
    autoDecodable: true,
  },
  {
    name: 'FM Broadcast',
    frequencyMhz: 98.0,
    bandwidthKhz: 200,
    modulation: 'WBFM',
    dataRate: 'Analog audio',
    source: 'FM radio stations',
    autoDecodable: false,
  },
  {
    name: 'Iridium',
    frequencyMhz: 1626.0,
    bandwidthKhz: 41.67,
    modulation: 'DQPSK',
    dataRate: '50 kbps',
    source: 'Iridium constellation (LEO)',
    autoDecodable: false,
  },
  {
    name: 'GPS L1 C/A',
    frequencyMhz: 1575.42,
    bandwidthKhz: 2046,
    modulation: 'BPSK (DSSS)',
    dataRate: '50 bps (nav msg)',
    source: 'GPS constellation (MEO)',
    autoDecodable: false,
  },
  {
    name: 'LoRa ISM',
    frequencyMhz: 915.0,
    bandwidthKhz: 125,
    modulation: 'CSS (Chirp)',
    dataRate: '0.3–27 kbps',
    source: 'IoT devices',
    autoDecodable: false,
  },
]

// ── ML Models ──

export const mlModels: MLModel[] = [
  {
    name: 'VTCNN2',
    architecture: '2-layer CNN on raw IQ samples (DeepSig architecture)',
    inputShape: '(2, 128) — I/Q × 128 samples',
    accuracy: '92.4% at SNR > 0 dB',
    dataset: 'RadioML 2016.10a',
    modulationsSupported: 11,
    inferenceTimeMs: 2.1,
    description: 'VT-CNN2 (Virginia Tech CNN) — the foundational deep learning model for automatic modulation recognition. Operates directly on raw I/Q samples with two convolutional layers followed by dense layers. Fast inference makes it suitable for real-time classification.',
  },
  {
    name: 'ResNet1D',
    architecture: 'Residual network adapted for 1D IQ time-series',
    inputShape: '(2, 1024) — I/Q × 1024 samples',
    accuracy: '95.1% at SNR > 0 dB',
    dataset: 'RadioML 2018.01a',
    modulationsSupported: 24,
    inferenceTimeMs: 4.8,
    description: 'ResNet adapted for 1D signal classification using residual connections to train deeper networks. Longer input window (1024 samples) captures more signal structure, improving accuracy on higher-order modulations at the cost of slightly higher inference time.',
  },
]

// ── Sample Classification History ──

export const classificationHistory: ClassificationResult[] = [
  {
    timestamp: '2026-03-24T10:15:32Z',
    frequencyMhz: 1694.1,
    bandwidthKhz: 600,
    modulationType: 'BPSK',
    confidence: 0.97,
    snrDb: 14.2,
    modelUsed: 'VTCNN2',
    inferenceTimeMs: 1.8,
  },
  {
    timestamp: '2026-03-24T10:16:01Z',
    frequencyMhz: 137.9,
    bandwidthKhz: 120,
    modulationType: 'QPSK',
    confidence: 0.94,
    snrDb: 11.5,
    modelUsed: 'ResNet1D',
    inferenceTimeMs: 4.2,
  },
  {
    timestamp: '2026-03-24T10:16:45Z',
    frequencyMhz: 98.1,
    bandwidthKhz: 200,
    modulationType: 'WBFM',
    confidence: 0.99,
    snrDb: 25.3,
    modelUsed: 'VTCNN2',
    inferenceTimeMs: 1.5,
  },
  {
    timestamp: '2026-03-24T10:17:12Z',
    frequencyMhz: 1090.0,
    bandwidthKhz: 2000,
    modulationType: 'PPM',
    confidence: 0.88,
    snrDb: 8.7,
    modelUsed: 'VTCNN2',
    inferenceTimeMs: 2.0,
  },
  {
    timestamp: '2026-03-24T10:18:30Z',
    frequencyMhz: 915.0,
    bandwidthKhz: 125,
    modulationType: 'CSS',
    confidence: 0.82,
    snrDb: 6.1,
    modelUsed: 'ResNet1D',
    inferenceTimeMs: 5.1,
  },
  {
    timestamp: '2026-03-24T10:19:05Z',
    frequencyMhz: 137.1,
    bandwidthKhz: 34,
    modulationType: 'AM',
    confidence: 0.91,
    snrDb: 9.8,
    modelUsed: 'VTCNN2',
    inferenceTimeMs: 1.7,
  },
  {
    timestamp: '2026-03-24T10:20:00Z',
    frequencyMhz: 1575.42,
    bandwidthKhz: 2046,
    modulationType: 'BPSK',
    confidence: 0.86,
    snrDb: 5.2,
    modelUsed: 'ResNet1D',
    inferenceTimeMs: 4.5,
  },
  {
    timestamp: '2026-03-24T10:21:15Z',
    frequencyMhz: 1626.0,
    bandwidthKhz: 41.67,
    modulationType: 'QPSK',
    confidence: 0.79,
    snrDb: 4.8,
    modelUsed: 'ResNet1D',
    inferenceTimeMs: 5.3,
  },
]

// ── Signal Chain ──

export const monitorChain: SignalChain = {
  name: 'AI Signal Monitor Pipeline',
  description: 'Wideband RF capture through ML classification to automatic signal identification and decoding.',
  phase: 6,
  planned: false,
  blocks: [
    { label: 'RTL-SDR', type: 'hardware' },
    { label: 'IQ Capture', type: 'dsp' },
    { label: 'Preprocess', type: 'dsp' },
    { label: 'CNN Classifier', type: 'ml' },
    { label: 'Signal ID', type: 'ml' },
    { label: 'Auto-Decode', type: 'decode' },
  ],
}
