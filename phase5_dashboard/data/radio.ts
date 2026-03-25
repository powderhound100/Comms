import type { SignalChain } from './gnu-radio'

// ── Signal chains per demodulation mode ──

export const radioChains: Record<string, SignalChain> = {
  wfm: {
    name: 'WFM Reception',
    description: 'Wideband FM demodulation — broadcast radio at 200 kHz deviation.',
    phase: 5,
    planned: false,
    blocks: [
      { label: 'Antenna', type: 'hardware' },
      { label: 'RTL-SDR', type: 'hardware' },
      { label: 'Phase Diff', type: 'dsp' },
      { label: 'Decimate ×50', type: 'dsp' },
      { label: 'De-emphasis 75μs', type: 'dsp' },
      { label: 'Normalize', type: 'dsp' },
      { label: 'Int16 PCM', type: 'decode' },
      { label: 'WebSocket', type: 'app' },
      { label: 'AudioWorklet', type: 'app' },
    ],
  },
  nfm: {
    name: 'NFM Reception',
    description: 'Narrowband FM demodulation — public safety, marine, amateur at 5 kHz deviation.',
    phase: 5,
    planned: false,
    blocks: [
      { label: 'Antenna', type: 'hardware' },
      { label: 'RTL-SDR', type: 'hardware' },
      { label: 'Phase Diff', type: 'dsp' },
      { label: 'Butter LPF 5 kHz', type: 'dsp' },
      { label: 'Decimate ×150', type: 'dsp' },
      { label: 'De-emphasis 50μs', type: 'dsp' },
      { label: 'Normalize', type: 'dsp' },
      { label: 'Int16 PCM', type: 'decode' },
      { label: 'WebSocket', type: 'app' },
      { label: 'AudioWorklet', type: 'app' },
    ],
  },
  am: {
    name: 'AM Reception',
    description: 'Amplitude modulation envelope detection — aviation and shortwave.',
    phase: 5,
    planned: false,
    blocks: [
      { label: 'Antenna', type: 'hardware' },
      { label: 'RTL-SDR', type: 'hardware' },
      { label: 'Envelope |IQ|', type: 'dsp' },
      { label: 'DC Remove', type: 'dsp' },
      { label: 'Butter BPF 300–3.4k', type: 'dsp' },
      { label: 'Decimate ×150', type: 'dsp' },
      { label: 'Normalize', type: 'dsp' },
      { label: 'Int16 PCM', type: 'decode' },
      { label: 'WebSocket', type: 'app' },
      { label: 'AudioWorklet', type: 'app' },
    ],
  },
}

// ── Spectrum analysis pipeline ──

export const spectrumChain: SignalChain = {
  name: 'Spectrum Analysis',
  description: 'Power spectral density computed server-side and rendered on a canvas overlay.',
  phase: 5,
  planned: false,
  blocks: [
    { label: 'IQ Samples', type: 'hardware' },
    { label: 'Welch PSD 1024', type: 'dsp' },
    { label: 'dB Scale', type: 'dsp' },
    { label: 'DC-Center', type: 'dsp' },
    { label: 'JSON', type: 'decode' },
    { label: 'WebSocket', type: 'app' },
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
    demod: 'Phase differentiation',
    filter: 'None (wideband)',
    outputRate: '48 kHz',
    deEmphasis: '75 μs (North America)',
    typicalUse: 'FM broadcast radio',
  },
  {
    key: 'nfm',
    label: 'NFM',
    demod: 'Phase differentiation',
    filter: 'Butterworth LPF 5 kHz',
    outputRate: '16 kHz',
    deEmphasis: '50 μs',
    typicalUse: 'Public safety, marine, amateur',
  },
  {
    key: 'am',
    label: 'AM',
    demod: 'Envelope |IQ|',
    filter: 'Butterworth BPF 300–3400 Hz',
    outputRate: '16 kHz',
    deEmphasis: 'None',
    typicalUse: 'Aviation, shortwave, AM broadcast',
  },
]

// ── Audio transport protocol ──

export const audioTransport: { label: string; value: string }[] = [
  { label: 'Protocol', value: 'WebSocket (binary frames)' },
  { label: 'Frame Header', value: '1 B mode + 4 B sampleRate (LE uint32)' },
  { label: 'Payload', value: 'Int16 PCM samples' },
  { label: 'Chunk Size', value: '~437 ms per frame' },
  { label: 'Jitter Buffer', value: '5 chunks (~100 ms) before playback' },
  { label: 'Playback', value: 'AudioWorklet ring buffer → speakers' },
  { label: 'Spectrum', value: 'JSON text frames (PSD dBFS array)' },
]

// ── DSP concepts glossary ──

export interface DSPConcept {
  term: string
  description: string
}

export const dspConcepts: DSPConcept[] = [
  {
    term: 'Phase Differentiation',
    description:
      'FM demodulation by computing the instantaneous frequency as the derivative of the signal phase. Each IQ sample\'s phase is compared to the previous sample — the difference is proportional to the modulating audio.',
  },
  {
    term: 'De-emphasis',
    description:
      'A low-pass filter that reverses the pre-emphasis applied at the transmitter. FM broadcast uses a 75 μs time constant in North America (50 μs elsewhere), restoring flat audio response.',
  },
  {
    term: 'Envelope Detection',
    description:
      'AM demodulation by computing the magnitude of each IQ sample: √(I² + Q²). The envelope tracks the amplitude variations that carry the audio content.',
  },
  {
    term: 'Welch PSD',
    description:
      'Power Spectral Density estimation using overlapping, windowed FFT segments averaged together. Produces a smoother spectrum display than a single FFT, reducing noise variance at the cost of frequency resolution.',
  },
  {
    term: 'Jitter Buffer',
    description:
      'A small FIFO buffer (5 chunks ≈ 100 ms) that absorbs network timing variations before audio playback begins. Trades a fixed startup latency for continuous, gap-free audio output.',
  },
  {
    term: 'Butterworth Filter',
    description:
      'A maximally-flat magnitude response filter with no ripple in the passband. Used here as a low-pass (NFM) or band-pass (AM) to limit audio bandwidth before decimation.',
  },
]
