// GROUNDLINK Ground Station — Hardware, Automation, and Capture Workflows

import { SignalChain } from './gnu-radio'

export interface HardwareComponent {
  name: string
  model: string
  spec: string
  cost: string
  role: string
}

export interface AutomationScript {
  name: string
  file: string
  description: string
  inputs: string
  outputs: string
  parameters: { label: string; value: string }[]
}

export interface CaptureWorkflowStep {
  step: number
  name: string
  script: string
  automated: boolean
  description: string
}

// ── Hardware Stack ──

export const hardwareStack: HardwareComponent[] = [
  {
    name: 'Dish Antenna',
    model: 'DirecTV Slimline 5',
    spec: '51×61 cm offset reflector',
    cost: '$15',
    role: 'Primary L-band reflector for GOES/satellite reception',
  },
  {
    name: 'Feed',
    model: 'Custom L-band cantenna',
    spec: 'Circular waveguide, ~10 dBi gain',
    cost: '$10',
    role: 'Illuminates dish at 1694 MHz with RHCP via helix insert',
  },
  {
    name: 'LNA',
    model: 'SAWbird+ GOES',
    spec: '0.5 dB NF, 34 dB gain, SAW filter',
    cost: '$35',
    role: 'Low-noise first stage with integrated bandpass filter',
  },
  {
    name: 'SDR (RX)',
    model: 'RTL-SDR Blog V4',
    spec: '8-bit ADC, 2.56 Msps max, HF–1.7 GHz',
    cost: '$35',
    role: 'Primary receive SDR for IQ capture and live demod',
  },
  {
    name: 'SDR (TX)',
    model: 'ADALM-Pluto',
    spec: '12-bit ADC/DAC, 325–3800 MHz, full-duplex',
    cost: '$200',
    role: 'Transmit SDR for loopback and future uplink experiments',
  },
  {
    name: 'Cabling',
    model: 'SMA cables + adapters',
    spec: '50 Ω, SMA-M to SMA-M, various lengths',
    cost: '$10',
    role: 'RF interconnects between antenna feed, LNA, and SDR',
  },
  {
    name: 'Host PC',
    model: 'Desktop / Laptop',
    spec: 'USB 3.0, GNU Radio, Python 3.10+',
    cost: '—',
    role: 'SDR host, signal processing, automation runtime',
  },
]

// ── Noise Budget ──

export const noiseBudget = [
  { stage: 'LNA (SAWbird+ GOES)', gain_dB: 34, nf_dB: 0.5, noiseTemp_K: 35 },
  { stage: 'Cable Loss', gain_dB: -1, nf_dB: 1.0, noiseTemp_K: 75 },
  { stage: 'RTL-SDR V4', gain_dB: 0, nf_dB: 4.5, noiseTemp_K: 528 },
]

// ── Automation Scripts ──

export const automationScripts: AutomationScript[] = [
  {
    name: 'predict_pass.py',
    file: 'phase2_ground_station/scripts/predict_pass.py',
    description: 'Computes upcoming satellite pass windows using TLE data and observer location. Outputs AOS/LOS times, max elevation, and azimuth profile.',
    inputs: 'TLE file, observer lat/lon/alt',
    outputs: 'Pass schedule JSON with AOS, LOS, max elevation',
    parameters: [
      { label: 'Satellite', value: 'GOES-18 (default), configurable' },
      { label: 'Horizon', value: '10° minimum elevation' },
      { label: 'Lookahead', value: '48 hours' },
      { label: 'Library', value: 'Skyfield / sgp4' },
    ],
  },
  {
    name: 'capture_session.py',
    file: 'phase2_ground_station/scripts/capture_session.py',
    description: 'Orchestrates a full IQ capture session: starts RTL-SDR, records for pass duration, timestamps output file, logs metadata.',
    inputs: 'Pass schedule, center frequency, sample rate',
    outputs: 'IQ file (.cf32) + metadata JSON',
    parameters: [
      { label: 'Sample Rate', value: '2.4 Msps' },
      { label: 'Gain', value: 'Auto (AGC) or manual' },
      { label: 'Duration', value: 'AOS-to-LOS or manual timeout' },
      { label: 'Output Format', value: 'Complex Float32 (.cf32)' },
    ],
  },
  {
    name: 'doppler_profile.py',
    file: 'phase2_ground_station/scripts/doppler_profile.py',
    description: 'Generates predicted Doppler shift curve for a given pass. Outputs time-vs-frequency offset CSV for use in GNU Radio correction flowgraph.',
    inputs: 'TLE file, pass window, center frequency',
    outputs: 'Doppler CSV (timestamp, freq_offset_Hz)',
    parameters: [
      { label: 'Step Size', value: '0.1 s' },
      { label: 'Max Shift', value: '±40 kHz (LEO S-band)' },
      { label: 'Interpolation', value: 'Cubic spline' },
      { label: 'Reference Frame', value: 'Observer-centric' },
    ],
  },
  {
    name: 'measure_snr.py',
    file: 'phase2_ground_station/scripts/measure_snr.py',
    description: 'Measures in-band SNR from an IQ recording using PSD estimation. Compares measured value against predicted C/N₀ from link budget.',
    inputs: 'IQ file (.cf32), signal bandwidth',
    outputs: 'SNR (dB), C/N₀ (dB-Hz), delta from predicted',
    parameters: [
      { label: 'FFT Size', value: '4096' },
      { label: 'Averaging', value: '100 windows' },
      { label: 'Method', value: 'Adjacent-channel noise' },
      { label: 'Predicted C/N₀', value: 'From link budget JSON' },
    ],
  },
  {
    name: 'compare_predicted.py',
    file: 'phase2_ground_station/scripts/compare_predicted.py',
    description: 'Compares measured session results against link budget predictions. Generates validation report with pass/fail criteria.',
    inputs: 'Session metadata JSON, link budget output',
    outputs: 'Validation report (JSON + console summary)',
    parameters: [
      { label: 'Pass Threshold', value: '±3 dB of predicted C/N₀' },
      { label: 'Metrics', value: 'SNR, elevation, slant range' },
      { label: 'Output', value: 'JSON + table summary' },
    ],
  },
  {
    name: 'feed_dimensions.py',
    file: 'phase2_ground_station/scripts/feed_dimensions.py',
    description: 'Calculates optimal cantenna feed dimensions for a given frequency. Outputs waveguide diameter, length, and probe position.',
    inputs: 'Target frequency (MHz)',
    outputs: 'Feed dimensions (diameter, length, probe offset)',
    parameters: [
      { label: 'Frequency', value: '1694.1 MHz (GOES LRIT)' },
      { label: 'Waveguide Mode', value: 'TE₁₁ dominant' },
      { label: 'Cutoff Safety', value: '1.2× fc' },
      { label: 'Material', value: 'Copper pipe / tin can' },
    ],
  },
]

// ── Capture Workflow ──

export const captureWorkflow: CaptureWorkflowStep[] = [
  { step: 1, name: 'TLE Fetch', script: 'predict_pass.py', automated: true, description: 'Download latest TLEs from CelesTrak for target satellite constellation' },
  { step: 2, name: 'Pass Prediction', script: 'predict_pass.py', automated: true, description: 'Compute next visible pass windows with AOS/LOS and max elevation' },
  { step: 3, name: 'Link Budget', script: 'compare_predicted.py', automated: true, description: 'Run link budget for predicted pass geometry to set expected C/N₀' },
  { step: 4, name: 'IQ Capture', script: 'capture_session.py', automated: true, description: 'Record IQ samples for pass duration using RTL-SDR at configured rate' },
  { step: 5, name: 'SNR Measurement', script: 'measure_snr.py', automated: true, description: 'Measure in-band SNR from captured IQ and compute C/N₀' },
  { step: 6, name: 'Validation', script: 'compare_predicted.py', automated: true, description: 'Compare measured vs predicted C/N₀, generate pass/fail report' },
]

// ── Integration Roadmap (sgoudelis/ground-station) ──

export const integrationRoadmap = [
  {
    feature: 'Web UI Dashboard',
    source: 'sgoudelis/ground-station',
    groundlinkMapping: 'Extend GROUNDLINK Phase 5 dashboard with live pass status',
    status: 'planned' as const,
  },
  {
    feature: 'SatDump Integration',
    source: 'sgoudelis/ground-station',
    groundlinkMapping: 'Post-capture LRIT/LRPT decode pipeline via SatDump CLI',
    status: 'planned' as const,
  },
  {
    feature: 'Scheduler / Cron',
    source: 'sgoudelis/ground-station',
    groundlinkMapping: 'Automated pass scheduling tied to predict_pass.py output',
    status: 'planned' as const,
  },
  {
    feature: 'SDR Orchestration',
    source: 'sgoudelis/ground-station',
    groundlinkMapping: 'Multi-SDR management: time-share RTL-SDR between sat passes and ADS-B',
    status: 'planned' as const,
  },
]

// ── Signal Chain ──

export const captureChain: SignalChain = {
  name: 'Ground Station Capture Pipeline',
  description: 'Automated RF capture chain from antenna through SDR to validated measurements.',
  phase: 2,
  planned: false,
  blocks: [
    { label: 'Dish Antenna', type: 'hardware' },
    { label: 'Cantenna Feed', type: 'hardware' },
    { label: 'SAWbird+ LNA', type: 'hardware' },
    { label: 'RTL-SDR V4', type: 'hardware' },
    { label: 'IQ Capture', type: 'dsp' },
    { label: 'SNR Measure', type: 'dsp' },
    { label: 'Validation', type: 'app' },
  ],
}
