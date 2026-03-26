import type { SignalChain } from './gnu-radio'

// ── Signal chains per demodulation mode ──

export const radioChains: Record<string, SignalChain> = {
  wfm: {
    name: 'WFM Reception',
    description: 'Wideband FM demodulation in C — decimate first, then demod on 10x fewer samples.',
    phase: 5,
    planned: false,
    blocks: [
      { label: 'Antenna', type: 'hardware' },
      { label: 'RTL-SDR', type: 'hardware' },
      { label: 'FIR + Decimate ×10 IQ', type: 'dsp' },
      { label: 'Fast atan2 FM Demod', type: 'dsp' },
      { label: 'Decimate ×5 Audio', type: 'dsp' },
      { label: 'De-emphasis 75μs', type: 'dsp' },
      { label: 'Normalize → Int16', type: 'decode' },
      { label: 'Binary WebSocket', type: 'app' },
      { label: 'AudioWorklet', type: 'app' },
    ],
  },
  nfm: {
    name: 'NFM Reception',
    description: 'Narrowband FM in C — 3-stage IQ decimation (×50) then demod on ~5k samples.',
    phase: 5,
    planned: false,
    blocks: [
      { label: 'Antenna', type: 'hardware' },
      { label: 'RTL-SDR', type: 'hardware' },
      { label: 'FIR + Decimate ×50 IQ', type: 'dsp' },
      { label: 'Fast atan2 FM Demod', type: 'dsp' },
      { label: 'Decimate ×3 Audio', type: 'dsp' },
      { label: 'De-emphasis 50μs', type: 'dsp' },
      { label: 'Normalize → Int16', type: 'decode' },
      { label: 'Binary WebSocket', type: 'app' },
      { label: 'AudioWorklet', type: 'app' },
    ],
  },
  am: {
    name: 'AM Reception',
    description: 'AM envelope detection in C — decimate IQ first, then sqrt(I²+Q²) on ~5k samples.',
    phase: 5,
    planned: false,
    blocks: [
      { label: 'Antenna', type: 'hardware' },
      { label: 'RTL-SDR', type: 'hardware' },
      { label: 'FIR + Decimate ×50 IQ', type: 'dsp' },
      { label: 'Envelope √(I²+Q²)', type: 'dsp' },
      { label: 'DC Remove', type: 'dsp' },
      { label: 'Decimate ×3 Audio', type: 'dsp' },
      { label: 'Normalize → Int16', type: 'decode' },
      { label: 'Binary WebSocket', type: 'app' },
      { label: 'AudioWorklet', type: 'app' },
    ],
  },
  p25: {
    name: 'P25 Digital Reception',
    description: 'P25 decoding — FM discriminator piped to DSD-FME vocoder, decoded voice upsampled to 48 kHz.',
    phase: 7,
    planned: false,
    blocks: [
      { label: 'Antenna', type: 'hardware' },
      { label: 'RTL-SDR', type: 'hardware' },
      { label: 'FIR + Decimate ×50 IQ', type: 'dsp' },
      { label: 'Fast atan2 FM Disc', type: 'dsp' },
      { label: 'DSD-FME P25 Decode', type: 'decode' },
      { label: '8k → 48k Upsample', type: 'dsp' },
      { label: 'JSON WebSocket', type: 'app' },
      { label: 'AudioWorklet', type: 'app' },
    ],
  },
}

// ── Spectrum analysis pipeline ──

export const spectrumChain: SignalChain = {
  name: 'Spectrum Analysis',
  description: 'Inline radix-2 FFT in C on raw 2.4 MHz IQ, output every 3rd capture (~330ms).',
  phase: 5,
  planned: false,
  blocks: [
    { label: 'Raw IQ 2.4M', type: 'hardware' },
    { label: 'Hann Window', type: 'dsp' },
    { label: 'Radix-2 FFT 1024', type: 'dsp' },
    { label: 'Mag² → dBFS', type: 'dsp' },
    { label: '4× Bin Avg → 256', type: 'dsp' },
    { label: 'JSON WebSocket', type: 'app' },
    { label: 'Canvas', type: 'app' },
  ],
}

// ── Mode comparison table ──

export interface RadioMode {
  key: string
  label: string
  demod: string
  filter: string
  outputRate: string
  deEmphasis: string
  typicalUse: string
}

export const radioModes: RadioMode[] = [
  {
    key: 'wfm',
    label: 'WFM',
    demod: 'Fast atan2 (C)',
    filter: 'FIR LPF → ×10 IQ decim',
    outputRate: '48 kHz',
    deEmphasis: '75 μs IIR (North America)',
    typicalUse: 'FM broadcast radio',
  },
  {
    key: 'nfm',
    label: 'NFM',
    demod: 'Fast atan2 (C)',
    filter: 'FIR LPF → ×50 IQ decim (3-stage)',
    outputRate: '16 kHz',
    deEmphasis: '50 μs IIR',
    typicalUse: 'Public safety, marine, amateur',
  },
  {
    key: 'am',
    label: 'AM',
    demod: 'Envelope √(I²+Q²) (C)',
    filter: 'FIR LPF → ×50 IQ decim (3-stage)',
    outputRate: '16 kHz',
    deEmphasis: 'None',
    typicalUse: 'Aviation, shortwave, AM broadcast',
  },
  {
    key: 'p25',
    label: 'P25',
    demod: 'DSD-FME (subprocess)',
    filter: 'FIR LPF → ×50 IQ decim + FM disc',
    outputRate: '8 kHz → 48 kHz',
    deEmphasis: 'None (digital)',
    typicalUse: 'Public safety trunked (KCERS)',
  },
]

// ── Audio transport protocol ──

export const audioTransport: { label: string; value: string }[] = [
  { label: 'DSP Engine', value: 'groundlink_radio.exe (custom C, ~400 lines)' },
  { label: 'Audio Protocol', value: 'Binary WebSocket — raw int16 PCM (no base64)' },
  { label: 'Frame Format', value: "'A' tag + uint32 length + uint32 sampleRate + int16[]" },
  { label: 'Chunk Size', value: '~109 ms capture → <15 ms demod (well under real-time)' },
  { label: 'Jitter Buffer', value: '5 chunks (~100 ms) before playback' },
  { label: 'Playback', value: 'AudioWorklet ring buffer → speakers' },
  { label: 'Spectrum', value: "JSON text frames — 256 dBFS bins every ~330 ms" },
  { label: 'Retune', value: 'Kill + restart C process with new --freq (< 200 ms)' },
]

// ── DSP concepts glossary ──

export interface DSPConcept {
  term: string
  description: string
}

export const dspConcepts: DSPConcept[] = [
  {
    term: 'Decimate-First Architecture',
    description:
      'The key optimization: narrow the IQ to channel bandwidth BEFORE demodulation. WFM decimates 262k IQ samples to 26k (×10), so the expensive atan2 runs on 10x fewer samples. NFM/AM decimate ×50 to ~5k samples.',
  },
  {
    term: 'Fast atan2 Approximation',
    description:
      'A polynomial approximation of atan2 (~50 CPU cycles vs ~500 for libm atan2f). Uses the identity atan2(y,x) ≈ π/4 + polynomial correction based on the ratio (x−|y|)/(x+|y|). From rtl_fm, accurate to ~0.07°.',
  },
  {
    term: 'FIR Low-Pass + Decimation',
    description:
      'A 16-tap FIR filter (windowed sinc × Hamming) anti-aliases before downsampling. Each decimation stage filters to half the new Nyquist frequency, then keeps every Nth sample. Cascaded stages keep each factor small.',
  },
  {
    term: 'De-emphasis IIR',
    description:
      'Single-pole IIR filter: y[n] = y[n-1] + α·(x[n] - y[n-1]). Reverses the pre-emphasis applied at the transmitter. FM broadcast uses τ = 75 μs (North America), NFM uses 50 μs. α = 1 - e^(-1/(fs·τ)).',
  },
  {
    term: 'Envelope Detection',
    description:
      'AM demodulation by computing the magnitude of each IQ sample: √(I² + Q²). After IQ decimation to channel bandwidth, the envelope tracks the amplitude variations that carry the audio content.',
  },
  {
    term: 'Radix-2 FFT',
    description:
      'In-place Cooley-Tukey FFT on 1024 complex IQ samples. Hann-windowed, then bit-reversal + butterfly stages. Output bins averaged 4× to 256 points, converted to dBFS for spectrum display.',
  },
  {
    term: 'Jitter Buffer',
    description:
      'A small FIFO buffer (5 chunks ≈ 100 ms) in the AudioWorklet that absorbs network timing variations before audio playback begins. Trades a fixed startup latency for continuous, gap-free audio output.',
  },
]
