// GROUNDLINK GNU Radio — GRC Flowgraphs, OOT Blocks, and Signal Flow Chains

export interface GRCFlowgraph {
  name: string
  file: string
  description: string
  blocks: string[]
  parameters: { label: string; value: string }[]
}

export interface OOTBlock {
  className: string
  description: string
  details: string
  inputs: string
  outputs: string
}

export interface SignalFlowBlock {
  label: string
  type: 'hardware' | 'dsp' | 'ccsds' | 'app' | 'attenuator' | 'decode' | 'ml'
}

export interface SignalChain {
  name: string
  description: string
  phase: number
  planned: boolean
  blocks: SignalFlowBlock[]
}

// ── Phase 2: GRC Flowgraphs ──

export const flowgraphs: GRCFlowgraph[] = [
  {
    name: 'GOES LRIT Receiver',
    file: 'phase2_ground_station/grc/goes_lrit_rx.grc',
    description: 'Receives and demodulates GOES-18 LRIT signal at 1694.1 MHz using an RTL-SDR and SAWbird+ GOES LNA.',
    blocks: ['RTL-SDR Source', 'Freq Xlating FIR', 'AGC', 'Costas Loop', 'Clock Recovery MM', 'Binary Slicer', 'File Sink'],
    parameters: [
      { label: 'Center Frequency', value: '1694.1 MHz' },
      { label: 'Sample Rate', value: '2.4 Msps' },
      { label: 'Symbol Rate', value: '293,883 sps' },
      { label: 'Modulation', value: 'BPSK' },
      { label: 'LNA', value: 'SAWbird+ GOES (0.5 dB NF)' },
    ],
  },
  {
    name: 'Meteor LRPT Receiver',
    file: 'phase2_ground_station/grc/meteor_lrpt_rx.grc',
    description: 'Captures Meteor-M2 LRPT imagery at 137.9 MHz with QPSK demodulation for weather image decoding.',
    blocks: ['RTL-SDR Source', 'Low Pass Filter', 'AGC', 'Costas Loop (4th)', 'Clock Recovery MM', 'Constellation Decoder', 'File Sink'],
    parameters: [
      { label: 'Center Frequency', value: '137.9 MHz' },
      { label: 'Sample Rate', value: '1.2 Msps' },
      { label: 'Symbol Rate', value: '72,000 sps' },
      { label: 'Modulation', value: 'QPSK' },
      { label: 'Antenna', value: 'QFH / V-Dipole' },
    ],
  },
  {
    name: 'IQ Recorder',
    file: 'phase2_ground_station/grc/iq_recorder.grc',
    description: 'General-purpose IQ capture flowgraph for recording raw baseband samples to disk for offline analysis.',
    blocks: ['RTL-SDR Source', 'DC Blocker', 'File Sink'],
    parameters: [
      { label: 'Center Frequency', value: 'Configurable' },
      { label: 'Sample Rate', value: 'Up to 2.56 Msps' },
      { label: 'Output Format', value: 'Complex Float32 (.cf32)' },
      { label: 'DC Removal', value: 'Enabled (32-tap)' },
    ],
  },
  {
    name: 'Doppler Corrector',
    file: 'phase2_ground_station/grc/doppler_corrector.grc',
    description: 'Applies real-time Doppler shift compensation to IQ recordings using TLE-derived frequency offset curves.',
    blocks: ['File Source', 'Sig Source (VCO)', 'Multiply', 'Freq Xlating FIR', 'File Sink'],
    parameters: [
      { label: 'Max Doppler Shift', value: '\u00b140 kHz (LEO S-band)' },
      { label: 'Update Rate', value: '10 Hz' },
      { label: 'Correction Source', value: 'CSV from predict/ephem' },
      { label: 'Interpolation', value: 'Linear' },
    ],
  },
  {
    name: 'SNR Estimator',
    file: 'phase2_ground_station/grc/snr_estimator.grc',
    description: 'Measures in-band SNR from live or recorded IQ data for link budget validation against predicted C/N\u2080.',
    blocks: ['File Source', 'PSD Estimator', 'SNR Probe', 'QT GUI Sink', 'CSV Logger'],
    parameters: [
      { label: 'FFT Size', value: '4096' },
      { label: 'Averaging', value: '100 frames' },
      { label: 'Noise BW', value: 'Adjacent channel method' },
      { label: 'Output', value: 'dB SNR + timestamp CSV' },
    ],
  },
]

// ── Phase 3: OOT Blocks (gr-groundlink) ──

export const ootBlocks: OOTBlock[] = [
  {
    className: 'ASMCorrelator',
    description: 'Correlates incoming bit stream against the CCSDS 32-bit Attached Sync Marker (0x1ACFFC1D) to find frame boundaries.',
    details: 'Sliding window correlator with configurable bit-error threshold. Supports both hard and soft bit inputs. Locks after N consecutive valid frames.',
    inputs: 'Bit stream (unpacked bytes)',
    outputs: 'Aligned CCSDS frames (PDU)',
  },
  {
    className: 'BERCounter',
    description: 'Counts bit errors between a reference and received bit stream for real-time BER measurement.',
    details: 'Synchronizes via ASM pattern, counts errors over configurable window (default 10\u2076 bits). Outputs running BER and total error count as message pairs.',
    inputs: 'Reference bits, Received bits',
    outputs: 'BER value (float message)',
  },
  {
    className: 'CCSDSFramer',
    description: 'Constructs CCSDS TM Transfer Frames from application data, adding header fields, frame counter, and CRC-16.',
    details: 'Implements CCSDS 132.0-B-3 TM frame format. Inserts 6-byte primary header (version, SCID, VCID, counter), appends CRC-16-CCITT, and prepends ASM.',
    inputs: 'Application data (PDU)',
    outputs: 'Complete CCSDS TM frames (PDU)',
  },
  {
    className: 'CCSDSDeframer',
    description: 'Extracts and validates CCSDS TM Transfer Frames, checking CRC and stripping header/trailer.',
    details: 'Verifies CRC-16-CCITT, extracts SCID, VCID, and frame counter from header. Drops invalid frames and reports statistics via message port.',
    inputs: 'Raw frame data (PDU)',
    outputs: 'Validated payload data (PDU)',
  },
  {
    className: 'CCSDSRandomizer',
    description: 'Applies/removes CCSDS pseudo-random sequence for spectrum whitening per CCSDS 131.0-B-4.',
    details: 'LFSR polynomial x\u2078+x\u2077+x\u2075+x\u00b3+1 (0xFF). XORs frame data starting after ASM. Sequence repeats every 255 bytes, synchronized to frame boundary.',
    inputs: 'Frame data (after ASM)',
    outputs: 'Randomized/derandomized frame data',
  },
  {
    className: 'ccsds_crc16',
    description: 'Computes and verifies CRC-16-CCITT checksum for CCSDS frame integrity checking.',
    details: 'Polynomial 0x1021, initial value 0xFFFF. Processes frame bytes MSB-first. Used by both CCSDSFramer (append) and CCSDSDeframer (verify).',
    inputs: 'Frame bytes',
    outputs: 'CRC-16 value / pass/fail flag',
  },
]

// ── Signal Flow Chains ──

export const signalChains: SignalChain[] = [
  {
    name: 'RX Path',
    description: 'Receive chain from antenna through demodulation to decoded application data.',
    phase: 2,
    planned: false,
    blocks: [
      { label: 'Antenna', type: 'hardware' },
      { label: 'LNA', type: 'hardware' },
      { label: 'RTL-SDR', type: 'hardware' },
      { label: 'DC Blocker', type: 'dsp' },
      { label: 'AGC', type: 'dsp' },
      { label: 'Costas Loop', type: 'dsp' },
      { label: 'Clock Recovery', type: 'dsp' },
      { label: 'ASM Correlator', type: 'ccsds' },
      { label: 'Deframer', type: 'ccsds' },
      { label: 'Decoder', type: 'app' },
    ],
  },
  {
    name: 'TX Path',
    description: 'Transmit chain from application data through modulation to RF output.',
    phase: 3,
    planned: false,
    blocks: [
      { label: 'App Data', type: 'app' },
      { label: 'CCSDS Framer', type: 'ccsds' },
      { label: 'Randomizer', type: 'ccsds' },
      { label: 'Conv Encoder', type: 'dsp' },
      { label: 'BPSK Mod', type: 'dsp' },
      { label: 'PlutoSDR', type: 'hardware' },
    ],
  },
  {
    name: 'Loopback Path',
    description: 'Combined TX \u2192 attenuator \u2192 RX for end-to-end validation without over-the-air transmission.',
    phase: 4,
    planned: true,
    blocks: [
      { label: 'App Data', type: 'app' },
      { label: 'CCSDS Framer', type: 'ccsds' },
      { label: 'BPSK Mod', type: 'dsp' },
      { label: 'PlutoSDR TX', type: 'hardware' },
      { label: '30 dB Atten', type: 'attenuator' },
      { label: 'RTL-SDR RX', type: 'hardware' },
      { label: 'Costas Loop', type: 'dsp' },
      { label: 'ASM Correlator', type: 'ccsds' },
      { label: 'Deframer', type: 'ccsds' },
      { label: 'BER Counter', type: 'app' },
    ],
  },
]

// ── Phase Summaries ──

export const phaseSummaries = {
  phase2: {
    title: 'Phase 2 \u2014 Ground Station',
    count: 5,
    label: 'GRC Flowgraphs',
    description: 'GNU Radio Companion flowgraphs for satellite signal reception, recording, and analysis.',
  },
  phase3: {
    title: 'Phase 3 \u2014 CCSDS Modem',
    count: 6,
    label: 'OOT Blocks',
    description: 'Custom out-of-tree GNU Radio blocks implementing the CCSDS TM waveform stack.',
  },
  phase4: {
    title: 'Phase 4 \u2014 Loopback',
    count: 3,
    label: 'Signal Chains',
    description: 'End-to-end signal flow chains connecting SDR hardware with the CCSDS modem.',
  },
}
