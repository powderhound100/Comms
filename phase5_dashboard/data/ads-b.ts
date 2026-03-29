// GROUNDLINK ADS-B — Aircraft Tracking with RTL-SDR

import { SignalChain } from './gnu-radio'

export interface ADSBMessageType {
  name: string
  typeCodeRange: string
  fields: string[]
  example: string
}

export interface ADSBSoftware {
  name: string
  description: string
  installCommand: string
  url: string
}

export interface IntegrationScenario {
  name: string
  description: string
  details: string
}

// ── RF Parameters ──

export const rfParameters = [
  { label: 'Frequency', value: '1090 MHz' },
  { label: 'Modulation', value: 'Pulse Position Modulation (PPM)' },
  { label: 'Data Rate', value: '1 Mbps' },
  { label: 'Message Length', value: '112 bits (Extended Squitter)' },
  { label: 'Preamble', value: '8 μs' },
  { label: 'Bandwidth', value: '~2 MHz' },
  { label: 'Transmit Power', value: '125–500 W (airborne)' },
  { label: 'Typical Range', value: '~250 nm (line of sight)' },
]

// ── Message Types ──

export const messageTypes: ADSBMessageType[] = [
  {
    name: 'Airborne Position',
    typeCodeRange: 'TC 9–18',
    fields: ['Latitude (CPR)', 'Longitude (CPR)', 'Altitude', 'Surveillance Status'],
    example: '8D4840D6 202CC371 C32CE0 576098',
  },
  {
    name: 'Airborne Velocity',
    typeCodeRange: 'TC 19',
    fields: ['Ground Speed', 'Heading', 'Vertical Rate', 'Speed Type'],
    example: '8D485020 9909121C C00A0A0A 6D0541',
  },
  {
    name: 'Aircraft Identification',
    typeCodeRange: 'TC 1–4',
    fields: ['Callsign (8 chars)', 'Emitter Category', 'Wake Turbulence'],
    example: '8D4840D6 23101530 B1E82C 2F5F19',
  },
  {
    name: 'Surveillance Status',
    typeCodeRange: 'TC 28–31',
    fields: ['Emergency State', 'Squawk Code', 'IDENT Flag', 'SPI'],
    example: '8D4840D6 E1005C 5FF838 69F5A8',
  },
  {
    name: 'Surface Position',
    typeCodeRange: 'TC 5–8',
    fields: ['Ground Track', 'Ground Speed', 'Latitude', 'Longitude'],
    example: '8C4841753AAB238733B8 48F83D41',
  },
]

// ── Hardware ──

export const hardware = [
  { name: 'RTL-SDR Blog V4', spec: '8-bit, 2.56 Msps, USB dongle', cost: '$35', sharedWithGroundlink: true },
  { name: '1090 MHz BPF', spec: 'Bandpass filter, 20 MHz passband', cost: '$15', sharedWithGroundlink: false },
  { name: 'Quarter-Wave Ground Plane', spec: '1090 MHz, ~3 dBi omnidirectional', cost: '$10', sharedWithGroundlink: false },
  { name: 'USB Extension Cable', spec: 'USB 2.0/3.0, shielded, 2 m', cost: '$5', sharedWithGroundlink: false },
]

// ── Software Stack ──

export const software: ADSBSoftware[] = [
  {
    name: 'dump1090 / readsb',
    description: 'Mode S and ADS-B decoder for RTL-SDR. Demodulates 1090 MHz PPM, decodes ADS-B messages, serves data via TCP/HTTP.',
    installCommand: 'sudo apt install readsb',
    url: 'https://github.com/wiedehopf/readsb',
  },
  {
    name: 'tar1090',
    description: 'Web-based ADS-B map interface. Displays aircraft positions, tracks, and metadata on an interactive map.',
    installCommand: 'sudo bash -c "$(curl -fsSL https://github.com/wiedehopf/tar1090/raw/master/install.sh)"',
    url: 'https://github.com/wiedehopf/tar1090',
  },
  {
    name: 'FlightAware PiAware',
    description: 'FlightAware feeder software. Feeds ADS-B data to FlightAware network, provides local Skyview web UI.',
    installCommand: 'wget https://piaware.flightcdn.com/piaware-repository.deb && sudo dpkg -i piaware-repository.deb',
    url: 'https://flightaware.com/adsb/piaware/',
  },
  {
    name: 'Virtual Radar Server',
    description: 'Windows/.NET ADS-B aggregator with web interface, database logging, and multi-feed support.',
    installCommand: 'Download from virtualradarserver.co.uk',
    url: 'https://www.virtualradarserver.co.uk/',
  },
]

// ── Integration Scenarios ──

export const integrationScenarios: IntegrationScenario[] = [
  {
    name: 'SDR Time-Sharing',
    description: 'Share a single RTL-SDR between satellite passes and ADS-B monitoring',
    details: 'When no satellite pass is scheduled, the RTL-SDR tunes to 1090 MHz for ADS-B reception. The scheduler in capture_session.py preempts ADS-B to capture satellite passes, then returns to ADS-B monitoring.',
  },
  {
    name: 'Dual-SDR Setup',
    description: 'Dedicated RTL-SDR dongles for satellite and ADS-B simultaneously',
    details: 'Run two RTL-SDR V4 dongles on separate USB buses — one permanently on 1090 MHz for ADS-B, the other available for satellite passes. Eliminates scheduling conflicts.',
  },
  {
    name: 'ADS-B as RTL-SDR Validation',
    description: 'Use ADS-B as a first project to validate SDR hardware and software stack',
    details: 'ADS-B is an ideal first RTL-SDR project: strong signals, immediate visual feedback via tar1090, and validates that the SDR, USB, and software pipeline work correctly before attempting weaker satellite signals.',
  },
]

// ── Decoder Pipeline (groundlink_adsb.c internals) ──

export interface DecoderStage {
  name: string
  description: string
  detail: string
  type: 'hardware' | 'dsp' | 'decode' | 'app'
}

export const decoderPipeline: DecoderStage[] = [
  {
    name: 'Raw IQ Capture',
    description: 'RTL-SDR samples 1090 MHz at 2.0 Msps, 8-bit unsigned I/Q',
    detail: 'rtlsdr_read_async() with 256 KB buffers, automatic gain or manual via --gain flag',
    type: 'hardware',
  },
  {
    name: 'Magnitude LUT',
    description: 'Precomputed 256×256 lookup table converts I/Q pairs to magnitude',
    detail: 'maglut[256][256] = sqrt(I² + Q²) × 258, computed once at startup to avoid per-sample math',
    type: 'dsp',
  },
  {
    name: 'Preamble Detection',
    description: 'Sliding window scans magnitude stream for ADS-B preamble pattern',
    detail: '8 μs preamble: pulses at 0, 1, 3.5, 4.5 μs — validated by threshold ratio between high/low samples',
    type: 'dsp',
  },
  {
    name: 'PPM Bit Extraction',
    description: 'Pulse Position Modulation decodes 112 bits from sample magnitudes',
    detail: 'Each bit = 1 μs (2 samples at 2 Msps). Bit value determined by comparing first vs second half-period magnitude',
    type: 'dsp',
  },
  {
    name: 'CRC-24 Validation',
    description: 'Verifies message integrity using ADS-B polynomial',
    detail: 'Generator polynomial 0xFFF409 (x²⁴ + x²³ + x¹⁰ + x³ + 1). Remainder must be zero for valid messages',
    type: 'decode',
  },
  {
    name: 'Message Parsing',
    description: 'Dispatches by Downlink Format — DF17 decoded by TypeCode',
    detail: 'DF17 = Extended Squitter. TC 1–4: identification, TC 9–18: airborne position, TC 19: velocity, TC 5–8: surface',
    type: 'decode',
  },
  {
    name: 'CPR Position Decode',
    description: 'Compact Position Reporting resolves lat/lon from even/odd frames',
    detail: 'Globally unambiguous decode requires both even (F=0) and odd (F=1) frames within 10 s. 17-bit lat/lon encoding',
    type: 'decode',
  },
  {
    name: 'Aircraft State Table',
    description: '256-slot hash table indexed by ICAO address, 60 s timeout',
    detail: 'Each slot: ICAO, callsign, lat, lon, altitude, speed, heading, vertical rate, last-seen timestamp. Evicted after 60 s silence',
    type: 'app',
  },
  {
    name: 'Binary Frame Output',
    description: 'Serializes aircraft state as fixed-width binary frames to stdout',
    detail: 'Frame types: D (data, per-aircraft), S (stats summary), M (raw message hex). Piped to adsb_streamer.py via stdout',
    type: 'app',
  },
]

// ── SDR Slot Definitions ──

export interface SdrSlotDef {
  slot: number
  serial: string
  label: string
  frequency: string
  mode: string
  streamer: string
  destination: string
  port: number
  color: string
}

export const sdrSlots: SdrSlotDef[] = [
  {
    slot: 0,
    serial: 'GROUNDLINK_1090',
    label: '1090 MHz ADS-B',
    frequency: '1090 MHz',
    mode: 'adsb',
    streamer: 'adsb_streamer.py',
    destination: 'TCP → DualAdsbServer',
    port: 9001,
    color: 'cyan',
  },
  {
    slot: 1,
    serial: 'GROUNDLINK_978',
    label: '978 MHz UAT',
    frequency: '978 MHz',
    mode: 'adsb',
    streamer: 'uat_streamer.py',
    destination: 'TCP → DualAdsbServer',
    port: 9002,
    color: 'orange',
  },
  {
    slot: 2,
    serial: 'GL_RADIO',
    label: 'FM / Scanner',
    frequency: 'Variable',
    mode: 'radio',
    streamer: 'radio_server.py',
    destination: 'WebSocket direct',
    port: 8770,
    color: 'emerald',
  },
]

// ── 3-Tier Data Flow ──

export interface DataFlowTier {
  tier: number
  name: string
  host: string
  port: number
  role: string
  processes: { name: string; detail: string }[]
}

export const dataFlowTiers: DataFlowTier[] = [
  {
    tier: 1,
    name: 'Pi SDR Node',
    host: '10.0.0.245',
    port: 8781,
    role: 'RF capture, decode, stream',
    processes: [
      { name: 'pi_agent.py', detail: 'Manages SDR dongle lifecycle, slot allocation, health reporting' },
      { name: 'groundlink_adsb', detail: 'C decoder — IQ → magnitude → preamble → CRC → aircraft state → binary frames' },
      { name: 'adsb_streamer.py', detail: 'Reads binary frames from decoder stdout, forwards via TCP to Windows host' },
    ],
  },
  {
    tier: 2,
    name: 'Windows Host',
    host: 'localhost',
    port: 8780,
    role: 'Aggregation, merge, serve',
    processes: [
      { name: 'sdr_agent.py', detail: 'Orchestrates Pi connection, mode switching, gain control via WebSocket commands' },
      { name: 'DualAdsbServer', detail: 'Merges 1090 MHz + 978 MHz feeds into unified aircraft list, serves WebSocket :8771' },
      { name: 'adsb_server.py', detail: 'HTTP API for aircraft log, spectrum data, Pi health proxy' },
    ],
  },
  {
    tier: 3,
    name: 'Dashboard',
    host: 'localhost',
    port: 3001,
    role: 'Visualization, control UI',
    processes: [
      { name: 'Next.js App', detail: 'WebSocket client consuming :8771 for live aircraft + spectrum data' },
      { name: '/api/pi/* proxy', detail: 'Server-side routes proxying Pi health, slot status, and control commands' },
      { name: 'AircraftMap', detail: 'Leaflet map rendering aircraft positions, trails, and airport overlays' },
    ],
  },
]

// ── Signal Chain ──

export const decodeChain: SignalChain = {
  name: 'ADS-B Decode Pipeline',
  description: 'End-to-end ADS-B aircraft tracking from 1090 MHz reception through decoding to web visualization.',
  phase: 2,
  planned: false,
  blocks: [
    { label: '1090 MHz Ant', type: 'hardware' },
    { label: 'BPF', type: 'hardware' },
    { label: 'RTL-SDR', type: 'hardware' },
    { label: 'dump1090', type: 'decode' },
    { label: 'Decoded Msgs', type: 'decode' },
    { label: 'tar1090 UI', type: 'app' },
  ],
}
