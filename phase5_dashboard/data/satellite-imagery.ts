// GROUNDLINK Satellite Imagery — Profiles, SatDump Pipelines, and Decoding Workflows

import { SignalChain } from './gnu-radio'
import { SatelliteImagery, SatDumpConfig, SignalQuality } from '@/lib/types'
import { CaptureWorkflowStep } from './ground-station'

export interface SatelliteProfile {
  name: string
  noradId: number
  frequency: string
  modulation: string
  dataRate: string
  captureType: 'LRIT' | 'LRPT' | 'APT'
  antenna: string
  lna: string
  description: string
}

// ── Satellite Profiles ──

export const satelliteProfiles: SatelliteProfile[] = [
  {
    name: 'GOES-18',
    noradId: 51850,
    frequency: '1694.1 MHz',
    modulation: 'BPSK',
    dataRate: '293,883 sps',
    captureType: 'LRIT',
    antenna: 'DirecTV Slimline 5 + L-band cantenna feed',
    lna: 'SAWbird+ GOES (0.5 dB NF)',
    description: 'Geostationary weather satellite providing continuous full-disk imagery of the Western Hemisphere via LRIT downlink.',
  },
  {
    name: 'Meteor-M2-3',
    noradId: 57166,
    frequency: '137.9 MHz',
    modulation: 'QPSK',
    dataRate: '72,000 sps',
    captureType: 'LRPT',
    antenna: 'QFH or V-Dipole',
    lna: 'Optional (signal is strong at VHF)',
    description: 'Russian LEO polar-orbiting weather satellite transmitting LRPT imagery at VHF with visible and infrared channels.',
  },
  {
    name: 'NOAA-19',
    noradId: 33591,
    frequency: '137.1 MHz',
    modulation: 'AM/FM (APT)',
    dataRate: '2 lines/sec',
    captureType: 'APT',
    antenna: 'QFH or V-Dipole',
    lna: 'Optional',
    description: 'US polar-orbiting weather satellite with legacy APT analog imagery downlink. Easy to receive with minimal hardware.',
  },
]

// ── SatDump Pipeline Configs ──

export const satdumpPipelines: SatDumpConfig[] = [
  {
    satellite: 'GOES-18',
    pipelineName: 'goes_hrit_lrit',
    inputFormat: 'baseband',
    sampleRate: 2400000,
    frequency: 1694100000,
    outputProducts: ['Full Disk', 'Mesoscale', 'EMWIN', 'DCS'],
  },
  {
    satellite: 'Meteor-M2-3',
    pipelineName: 'meteor_m2_lrpt',
    inputFormat: 'baseband',
    sampleRate: 900000,
    frequency: 137900000,
    outputProducts: ['Channel 1 (Visible)', 'Channel 2 (IR)', 'Channel 3 (IR)', 'RGB Composite'],
  },
  {
    satellite: 'NOAA-19',
    pipelineName: 'noaa_apt',
    inputFormat: 'baseband',
    sampleRate: 1000000,
    frequency: 137100000,
    outputProducts: ['Channel A (Visible)', 'Channel B (IR)', 'MSA Composite', 'Thermal Map'],
  },
]

// ── Sample Imagery (static placeholders) ──

export const sampleImagery: SatelliteImagery[] = [
  {
    id: 'goes18-fd-20260320',
    satellite: 'GOES-18',
    captureType: 'LRIT',
    capturedAt: '2026-03-20T18:00:00Z',
    imagePaths: ['/sat-images/goes18/fd_20260320_1800.png'],
    thumbnailPath: '/sat-images/goes18/fd_20260320_1800_thumb.png',
    channels: [
      { name: 'Full Disk Visible', type: 'visible', path: '/sat-images/goes18/fd_vis.png', resolution: '4 km' },
      { name: 'Full Disk IR', type: 'infrared', path: '/sat-images/goes18/fd_ir.png', resolution: '4 km' },
      { name: 'Enhanced Composite', type: 'enhanced', path: '/sat-images/goes18/fd_enh.png', resolution: '4 km' },
    ],
    decodeStatus: 'complete',
    signalQuality: { snrDb: 14.2, cn0Dbhz: 62.3, lockPercentage: 98.5, viterbiBer: 1e-6, rsErrors: 0 },
  },
  {
    id: 'meteor-m2-20260321',
    satellite: 'Meteor-M2-3',
    captureType: 'LRPT',
    capturedAt: '2026-03-21T14:32:00Z',
    imagePaths: ['/sat-images/meteor/lrpt_20260321_1432.png'],
    thumbnailPath: '/sat-images/meteor/lrpt_20260321_1432_thumb.png',
    channels: [
      { name: 'Channel 1 (Visible)', type: 'visible', path: '/sat-images/meteor/ch1_vis.png', resolution: '1 km' },
      { name: 'Channel 2 (Near-IR)', type: 'infrared', path: '/sat-images/meteor/ch2_nir.png', resolution: '1 km' },
      { name: 'RGB Composite', type: 'composite', path: '/sat-images/meteor/rgb_composite.png', resolution: '1 km' },
    ],
    decodeStatus: 'complete',
    signalQuality: { snrDb: 11.8, cn0Dbhz: 55.1, lockPercentage: 94.2, viterbiBer: 3e-5, rsErrors: 2 },
  },
  {
    id: 'noaa19-apt-20260322',
    satellite: 'NOAA-19',
    captureType: 'APT',
    capturedAt: '2026-03-22T09:15:00Z',
    imagePaths: ['/sat-images/noaa19/apt_20260322_0915.png'],
    thumbnailPath: '/sat-images/noaa19/apt_20260322_0915_thumb.png',
    channels: [
      { name: 'Channel A (Visible)', type: 'visible', path: '/sat-images/noaa19/chA_vis.png', resolution: '4 km' },
      { name: 'Channel B (Thermal IR)', type: 'infrared', path: '/sat-images/noaa19/chB_ir.png', resolution: '4 km' },
      { name: 'MSA Composite', type: 'composite', path: '/sat-images/noaa19/msa.png', resolution: '4 km' },
    ],
    decodeStatus: 'complete',
    signalQuality: { snrDb: 8.5, cn0Dbhz: 48.7, lockPercentage: 87.3, viterbiBer: 2e-4, rsErrors: 8 },
  },
  {
    id: 'goes18-meso-20260323',
    satellite: 'GOES-18',
    captureType: 'LRIT',
    capturedAt: '2026-03-23T21:45:00Z',
    imagePaths: ['/sat-images/goes18/meso_20260323_2145.png'],
    thumbnailPath: '/sat-images/goes18/meso_20260323_2145_thumb.png',
    channels: [
      { name: 'Mesoscale Visible', type: 'visible', path: '/sat-images/goes18/meso_vis.png', resolution: '1 km' },
      { name: 'Mesoscale IR', type: 'infrared', path: '/sat-images/goes18/meso_ir.png', resolution: '2 km' },
    ],
    decodeStatus: 'complete',
    signalQuality: { snrDb: 13.9, cn0Dbhz: 61.8, lockPercentage: 97.8, viterbiBer: 2e-6, rsErrors: 0 },
  },
  {
    id: 'meteor-m2-20260323',
    satellite: 'Meteor-M2-3',
    captureType: 'LRPT',
    capturedAt: '2026-03-23T03:10:00Z',
    imagePaths: ['/sat-images/meteor/lrpt_20260323_0310.png'],
    thumbnailPath: '/sat-images/meteor/lrpt_20260323_0310_thumb.png',
    channels: [
      { name: 'Channel 1 (Visible)', type: 'visible', path: '/sat-images/meteor/ch1_vis_2.png', resolution: '1 km' },
      { name: 'Channel 3 (Thermal IR)', type: 'infrared', path: '/sat-images/meteor/ch3_tir.png', resolution: '1 km' },
      { name: 'False Color', type: 'enhanced', path: '/sat-images/meteor/false_color.png', resolution: '1 km' },
    ],
    decodeStatus: 'complete',
    signalQuality: { snrDb: 10.3, cn0Dbhz: 52.9, lockPercentage: 91.6, viterbiBer: 8e-5, rsErrors: 4 },
  },
  {
    id: 'goes18-pending-20260324',
    satellite: 'GOES-18',
    captureType: 'LRIT',
    capturedAt: '2026-03-24T12:00:00Z',
    imagePaths: [],
    thumbnailPath: '',
    channels: [],
    decodeStatus: 'pending',
    signalQuality: { snrDb: 15.1, cn0Dbhz: 63.0, lockPercentage: 99.1, viterbiBer: 5e-7, rsErrors: 0 },
  },
]

// ── Decoding Workflow ──

export const decodingWorkflow: CaptureWorkflowStep[] = [
  { step: 1, name: 'IQ Capture', script: 'capture_session.py', automated: true, description: 'Record raw IQ baseband from RTL-SDR during satellite pass window' },
  { step: 2, name: 'Doppler Correction', script: 'doppler_profile.py', automated: true, description: 'Apply TLE-derived Doppler compensation to IQ recording (LEO only)' },
  { step: 3, name: 'SatDump Decode', script: 'satdump', automated: true, description: 'Run SatDump pipeline to demodulate and decode satellite data products' },
  { step: 4, name: 'Image Assembly', script: 'satdump', automated: true, description: 'Assemble decoded frames into channel images and composites' },
  { step: 5, name: 'Quality Check', script: 'measure_snr.py', automated: true, description: 'Measure SNR, lock percentage, and Viterbi BER from decode telemetry' },
  { step: 6, name: 'Gallery Ingest', script: 'imagery_ingest.py', automated: false, description: 'Index decoded images with metadata into the dashboard gallery store' },
]

// ── Signal Chain ──

export const imageryChain: SignalChain = {
  name: 'Satellite Imagery Pipeline',
  description: 'Antenna through SDR capture, SatDump decoding, to decoded weather imagery in the gallery.',
  phase: 2,
  planned: false,
  blocks: [
    { label: 'Antenna', type: 'hardware' },
    { label: 'LNA', type: 'hardware' },
    { label: 'RTL-SDR', type: 'hardware' },
    { label: 'IQ Capture', type: 'dsp' },
    { label: 'Doppler Corr', type: 'dsp' },
    { label: 'SatDump', type: 'decode' },
    { label: 'Image Decode', type: 'decode' },
    { label: 'Gallery', type: 'app' },
  ],
}
