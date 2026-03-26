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
