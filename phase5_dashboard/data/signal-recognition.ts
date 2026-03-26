// GROUNDLINK Signal Recognition — AMR with ML and RTL-SDR

import { SignalChain } from './gnu-radio'

export interface ModulationType {
  name: string
  category: 'analog' | 'digital-linear' | 'digital-frequency' | 'multi-carrier'
  description: string
  relevance: 'primary' | 'detectable' | 'reference'
}

export interface MLApproach {
  name: string
  architecture: string
  inputType: string
  pros: string[]
  cons: string[]
}

export interface Dataset {
  name: string
  modulations: number
  samples: string
  snrRange: string
  description: string
}

export interface PipelineStage {
  step: number
  name: string
  tool: string
  status: 'planned' | 'active' | 'complete'
  description: string
}

// ── Modulation Types ──

export const modulationTypes: ModulationType[] = [
  { name: 'BPSK', category: 'digital-linear', description: 'Binary Phase Shift Keying — 1 bit/symbol, used in GOES LRIT and CCSDS TM', relevance: 'primary' },
  { name: 'QPSK', category: 'digital-linear', description: 'Quadrature PSK — 2 bits/symbol, used in Meteor LRPT and CCSDS secondary mode', relevance: 'primary' },
  { name: 'AM-DSB', category: 'analog', description: 'Amplitude Modulation, Double Sideband — broadcast AM radio', relevance: 'reference' },
  { name: 'AM-SSB', category: 'analog', description: 'Single Sideband AM — HF radio, maritime', relevance: 'reference' },
  { name: 'FM', category: 'analog', description: 'Frequency Modulation — broadcast FM, NOAA APT', relevance: 'detectable' },
  { name: '8PSK', category: 'digital-linear', description: '8-ary PSK — 3 bits/symbol, higher-order CCSDS option', relevance: 'detectable' },
  { name: '16QAM', category: 'digital-linear', description: '16-point QAM — Wi-Fi, LTE, high-throughput links', relevance: 'reference' },
  { name: '64QAM', category: 'digital-linear', description: '64-point QAM — high spectral efficiency, noise-sensitive', relevance: 'reference' },
  { name: 'GFSK', category: 'digital-frequency', description: 'Gaussian FSK — Bluetooth, ISM band devices', relevance: 'detectable' },
  { name: 'CPFSK', category: 'digital-frequency', description: 'Continuous-Phase FSK — pager, telemetry links', relevance: 'detectable' },
  { name: 'PAM4', category: 'digital-linear', description: '4-level Pulse Amplitude Modulation — baseband signaling', relevance: 'reference' },
  { name: 'OFDM', category: 'multi-carrier', description: 'Orthogonal FDM — Wi-Fi, LTE, DVB-T multi-carrier', relevance: 'reference' },
]

// ── ML Approaches ──

export const mlApproaches: MLApproach[] = [
  {
    name: 'CNN on Spectrograms',
    architecture: '2D CNN (ResNet-style) on time-frequency images',
    inputType: 'Spectrogram (power spectral density images)',
    pros: ['Intuitive visual features', 'Transfer learning from ImageNet', 'Good at capturing spectral shape'],
    cons: ['Lossy time-domain info', 'Resolution tradeoffs (time vs freq)', 'Higher memory for large spectrograms'],
  },
  {
    name: 'IQ-based Deep Learning',
    architecture: 'DeepSig-style CNN operating on raw IQ samples',
    inputType: 'Raw IQ vectors (I/Q interleaved)',
    pros: ['No handcrafted features', 'Preserves phase information', 'State-of-the-art accuracy on RadioML'],
    cons: ['Requires large datasets', 'Sensitive to sample rate', 'Black-box feature extraction'],
  },
  {
    name: 'LSTM on Time-Series IQ',
    architecture: 'Bidirectional LSTM with attention mechanism',
    inputType: 'Sequential IQ samples (time-series)',
    pros: ['Captures temporal patterns', 'Variable-length inputs', 'Good for bursty signals'],
    cons: ['Slower training than CNN', 'Harder to parallelize', 'Gradient issues on long sequences'],
  },
  {
    name: 'Transformer-based AMR',
    architecture: 'Vision Transformer (ViT) or Signal Transformer on IQ',
    inputType: 'Tokenized IQ segments or spectrogram patches',
    pros: ['Global attention over signal', 'Scales well with data', 'State-of-the-art on large datasets'],
    cons: ['Compute-intensive', 'Needs large training sets', 'Complex hyperparameter tuning'],
  },
]

// ── Datasets ──

export const datasets: Dataset[] = [
  {
    name: 'RadioML 2016.10a',
    modulations: 11,
    samples: '220,000',
    snrRange: '-20 to +18 dB',
    description: 'DeepSig benchmark dataset with 11 modulation types at 20 SNR levels. Standard baseline for AMR research.',
  },
  {
    name: 'RadioML 2018.01a',
    modulations: 24,
    samples: '2,555,904',
    snrRange: '-20 to +30 dB',
    description: 'Extended dataset with 24 modulations including digital and analog types. Over-the-air channel effects simulated.',
  },
  {
    name: 'HisarMod',
    modulations: 26,
    samples: '780,000',
    snrRange: '-20 to +20 dB',
    description: 'Turkish university dataset with 26 modulation types. Includes higher-order QAM and OFDM variants.',
  },
]

// ── Pipeline Stages ──

export const pipelineStages: PipelineStage[] = [
  { step: 1, name: 'IQ Capture', tool: 'RTL-SDR + GNU Radio', status: 'complete', description: 'Record raw IQ samples from RTL-SDR at target frequency' },
  { step: 2, name: 'Preprocessing', tool: 'NumPy / SciPy', status: 'complete', description: 'Normalize, segment, and filter IQ data into fixed-length windows' },
  { step: 3, name: 'Feature Extraction', tool: 'NumPy / Matplotlib', status: 'complete', description: 'Generate spectrograms, constellation diagrams, or raw IQ tensors' },
  { step: 4, name: 'CNN Classifier', tool: 'PyTorch', status: 'active', description: 'Train and evaluate CNN model on RadioML dataset' },
  { step: 5, name: 'Post-Processing', tool: 'Python', status: 'planned', description: 'Confidence thresholding, multi-frame voting, result logging' },
  { step: 6, name: 'GNU Radio Integration', tool: 'gr-groundlink OOT', status: 'planned', description: 'Embed trained model as GNU Radio block for real-time classification' },
]

// ── Tools & Frameworks ──

export const tools = [
  { name: 'TensorFlow', role: 'Deep learning framework for CNN training and inference', url: 'https://tensorflow.org' },
  { name: 'PyTorch', role: 'Alternative DL framework with dynamic computation graphs', url: 'https://pytorch.org' },
  { name: 'GNU Radio', role: 'SDR framework for IQ capture and real-time signal processing', url: 'https://gnuradio.org' },
  { name: 'SigMF', role: 'Signal Metadata Format for annotating IQ recordings', url: 'https://sigmf.org' },
  { name: 'RadioML', role: 'Benchmark datasets for automatic modulation recognition', url: 'https://radioml.com' },
]

// ── Signal Chain ──

export const amrChain: SignalChain = {
  name: 'AMR Classification Pipeline',
  description: 'End-to-end automatic modulation recognition from RTL-SDR capture through ML inference.',
  phase: 5,
  planned: false,
  blocks: [
    { label: 'RTL-SDR', type: 'hardware' },
    { label: 'IQ Capture', type: 'dsp' },
    { label: 'Preprocess', type: 'dsp' },
    { label: 'Spectrogram', type: 'dsp' },
    { label: 'CNN Classifier', type: 'ml' },
    { label: 'Signal ID', type: 'ml' },
  ],
}
