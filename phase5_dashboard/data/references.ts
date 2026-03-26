// GROUNDLINK Reference Projects & Libraries
// Cross-project knowledge hub for satellite communications learning

export type Subject =
  | 'orbital-mechanics'
  | 'link-budget'
  | 'atmospheric-propagation'
  | 'antenna-design'
  | 'dsp-demodulation'
  | 'ccsds-framing'
  | 'forward-error-correction'
  | 'ber-analysis'
  | 'gnu-radio'
  | 'sdr-integration'
  | 'ground-station-automation'
  | 'satellite-tracking'
  | 'encryption-security'
  | 'web-visualization'
  | 'packet-protocols'

export interface StudyPath {
  path: string
  description: string
}

export interface ReferenceProject {
  name: string
  repo: string
  stars: string
  language: string
  license: string
  tier: 1 | 2 | 3
  phases: number[]
  subjects: Subject[]
  description: string
  studyPaths: StudyPath[]
  installCmd?: string
}

export interface SubjectInfo {
  id: Subject
  label: string
  description: string
  phases: number[]
}

export const subjects: SubjectInfo[] = [
  { id: 'orbital-mechanics', label: 'Orbital Mechanics', description: 'Orbit propagation, TLE, pass prediction, Doppler shift', phases: [1, 2, 5] },
  { id: 'link-budget', label: 'Link Budget', description: 'Power budgets, FSPL, margin analysis, G/T figure of merit', phases: [1, 5] },
  { id: 'atmospheric-propagation', label: 'Atmospheric Propagation', description: 'ITU-R models, rain attenuation, gaseous absorption', phases: [1] },
  { id: 'antenna-design', label: 'Antenna Design', description: 'Gain, beamwidth, feed design, offset parabolic', phases: [1, 2] },
  { id: 'dsp-demodulation', label: 'DSP & Demodulation', description: 'Carrier recovery, clock recovery, matched filtering, Costas loops', phases: [2, 3] },
  { id: 'ccsds-framing', label: 'CCSDS Framing', description: 'TM/TC frame formats, ASM sync markers, CRC, randomization', phases: [3, 4] },
  { id: 'forward-error-correction', label: 'Forward Error Correction', description: 'Viterbi, Reed-Solomon, LDPC, convolutional coding', phases: [3] },
  { id: 'ber-analysis', label: 'BER Analysis', description: 'BER curves, simulation methodology, coding gain measurement', phases: [1, 3, 4] },
  { id: 'gnu-radio', label: 'GNU Radio', description: 'OOT modules, flowgraph design, GRC files, signal processing', phases: [2, 3, 4] },
  { id: 'sdr-integration', label: 'SDR Integration', description: 'RTL-SDR, USRP, PlutoSDR hardware interfacing', phases: [2, 4] },
  { id: 'ground-station-automation', label: 'Ground Station Automation', description: 'Pass scheduling, capture orchestration, rotator control', phases: [2] },
  { id: 'satellite-tracking', label: 'Satellite Tracking', description: 'Real-time tracking, ground tracks, polar plots, maps', phases: [2, 5] },
  { id: 'encryption-security', label: 'Encryption & Security', description: 'AES-256, key management, crypto overhead, quantum-safe', phases: [4] },
  { id: 'web-visualization', label: 'Web Visualization', description: 'Dashboards, charts, real-time display, React frontends', phases: [5] },
  { id: 'packet-protocols', label: 'Packet Protocols', description: 'CCSDS space packets, PUS services, CFDP, telemetry extraction', phases: [3, 4] },
]

export const projects: ReferenceProject[] = [
  // ── Tier 1: Core Dependencies ──
  {
    name: 'SatDump',
    repo: 'https://github.com/SatDump/SatDump',
    stars: '2,000+',
    language: 'C++',
    license: 'GPL-3.0',
    tier: 1,
    phases: [2, 3],
    subjects: ['dsp-demodulation', 'ccsds-framing', 'forward-error-correction', 'sdr-integration', 'ground-station-automation'],
    description: 'Dominant open-source weather satellite decoder — full pipeline from raw IQ to decoded images',
    studyPaths: [
      { path: 'src/common/dsp/demod/', description: 'BPSK/QPSK demodulators with Costas loop and Gardner/M&M clock recovery' },
      { path: 'src/common/codings/viterbi/', description: 'Viterbi decoder with CCSDS r=1/2 k=7 polynomials (0x4F, 0x6D)' },
      { path: 'src/common/codings/reedsolomon/', description: 'RS(255,223) decoder for CCSDS concatenated coding' },
      { path: 'pipelines/GOES/HRIT/', description: 'Pipeline definition for GOES LRIT/HRIT — exact demod parameters' },
      { path: 'src/common/dsp/demod/constellation.h', description: 'Constellation soft-decision demapping for Viterbi' },
    ],
    installCmd: 'Download from GitHub Releases (pre-built binaries)',
  },
  {
    name: 'gr-satellites',
    repo: 'https://github.com/daniestevez/gr-satellites',
    stars: '900+',
    language: 'Python / C++',
    license: 'GPL-3.0',
    tier: 1,
    phases: [2, 3],
    subjects: ['ccsds-framing', 'forward-error-correction', 'gnu-radio', 'dsp-demodulation', 'packet-protocols'],
    description: 'Gold-standard GNU Radio OOT module for amateur satellite decoding by Daniel Estevez (EA4GPZ)',
    studyPaths: [
      { path: 'python/ccsds/', description: 'Complete CCSDS stack — ASM correlation, frame extraction, bit-slip handling' },
      { path: 'python/components/deframers/', description: 'Various deframer approaches to frame synchronization' },
      { path: 'grc/', description: 'Pre-built GRC flowgraph examples for multiple satellites' },
      { path: 'docs/', description: 'ReadTheDocs documentation on SatYAML, deframers, building blocks' },
    ],
    installCmd: 'pip install gr-satellites',
  },
  {
    name: 'ccsdspy',
    repo: 'https://github.com/CCSDSPy/ccsdspy',
    stars: '100+',
    language: 'Python',
    license: 'BSD-3',
    tier: 1,
    phases: [3],
    subjects: ['ccsds-framing', 'packet-protocols'],
    description: 'CCSDS Space Packet I/O library used at NASA, NOAA, and SwRI',
    studyPaths: [
      { path: 'ccsdspy/packet_types.py', description: 'CCSDS primary header field definitions (48-bit header structure)' },
      { path: 'ccsdspy/decode.py', description: 'Vectorized bit-field extraction using NumPy shifting and masking' },
    ],
    installCmd: 'pip install ccsdspy',
  },
  {
    name: 'spacepackets-py',
    repo: 'https://github.com/us-irs/spacepackets-py',
    stars: '50+',
    language: 'Python',
    license: 'Apache-2.0',
    tier: 1,
    phases: [3, 4],
    subjects: ['packet-protocols', 'ccsds-framing'],
    description: 'Comprehensive CCSDS + PUS + CFDP + USLP protocol library',
    studyPaths: [
      { path: 'spacepackets/ccsds/spacepacket.py', description: 'Space Packet Header with serialization/deserialization' },
      { path: 'spacepackets/ecss/', description: 'PUS telecommand/telemetry packet implementations' },
      { path: 'spacepackets/cfdp/', description: 'CCSDS File Delivery Protocol for file transfers over TM/TC' },
      { path: 'examples/', description: 'Working code examples for packet creation and parsing' },
    ],
    installCmd: 'pip install spacepackets',
  },
  {
    name: 'satellite.js',
    repo: 'https://github.com/shashwatak/satellite-js',
    stars: '800+',
    language: 'JavaScript',
    license: 'MIT',
    tier: 1,
    phases: [5],
    subjects: ['orbital-mechanics', 'satellite-tracking'],
    description: 'SGP4/SDP4 satellite orbit propagation in JavaScript for browser-based tracking',
    studyPaths: [
      { path: 'src/propagation/', description: 'SGP4/SDP4 propagator — how orbit prediction algorithms work' },
      { path: 'src/transforms.js', description: 'Coordinate frame transforms (ECI -> ECEF -> geodetic)' },
      { path: 'example/', description: 'Computing satellite position, velocity, and look angles' },
    ],
    installCmd: 'npm install satellite.js',
  },

  // ── Tier 2: Architecture References ──
  {
    name: 'pylink',
    repo: 'https://github.com/harrison-caudill/pylink',
    stars: '200+',
    language: 'Python',
    license: 'MIT',
    tier: 2,
    phases: [1],
    subjects: ['link-budget'],
    description: 'Mature link budget library using a DAG solver for automatic dependency resolution',
    studyPaths: [
      { path: 'pylink/model.py', description: 'DAGModel class — each parameter is a computed node with dependencies' },
      { path: 'pylink/tributaries/', description: 'Modular building blocks (transmitter, receiver, channel, antenna)' },
      { path: 'examples/', description: 'Complete link budget examples including HyperSpectral Imaging SNR' },
      { path: 'pylink/report.py', description: 'LaTeX report generator for formatted PDF link budget documents' },
    ],
  },
  {
    name: 'gr-SatelliteModem',
    repo: 'https://github.com/ydagne/gr-SatelliteModem',
    stars: '60+',
    language: 'Python / C++',
    license: 'GPL-3.0',
    tier: 2,
    phases: [3, 4],
    subjects: ['gnu-radio', 'dsp-demodulation', 'forward-error-correction', 'ber-analysis', 'sdr-integration'],
    description: 'Complete GNU Radio satellite modem with BPSK/QPSK, convolutional coding, and LDPC',
    studyPaths: [
      { path: 'python/packet_encoder.py', description: 'Packet framing with preamble, header, payload, and CRC' },
      { path: 'python/conv_encoder.py', description: 'Convolutional encoder with configurable rate and Viterbi decoder' },
      { path: 'examples/', description: 'Complete TX/RX flowgraphs for UHD (USRP) hardware' },
      { path: 'python/ldpc_encoder.py', description: 'LDPC encoder implementation for advanced FEC' },
    ],
  },
  {
    name: 'Ground Station',
    repo: 'https://github.com/sgoudelis/ground-station',
    stars: '2,400+',
    language: 'JavaScript / Python',
    license: 'GPL-3.0',
    tier: 2,
    phases: [2, 5],
    subjects: ['web-visualization', 'satellite-tracking', 'sdr-integration', 'ground-station-automation'],
    description: 'Full-stack ground station with React frontend, real-time tracking, SDR waterfall, and SatDump integration',
    studyPaths: [
      { path: 'frontend/', description: 'React + Redux Toolkit + Material-UI + Socket.IO real-time updates' },
      { path: 'backend/', description: 'Python SDR orchestration via pyrtlsdr and SoapySDR' },
      { path: 'scheduler/', description: 'Automated pass prediction, SDR configuration, and recording' },
    ],
  },
  {
    name: 'SatLink',
    repo: 'https://github.com/cfragoas/SatLink',
    stars: '50+',
    language: 'Python',
    license: 'MIT',
    tier: 2,
    phases: [1],
    subjects: ['link-budget', 'atmospheric-propagation'],
    description: 'Link budget calculator with PyQt5 GUI integrating validated ITU-R propagation models via itur package',
    studyPaths: [
      { path: 'satlink/propagation/', description: 'ITU-R propagation model implementations with clear parameterization' },
    ],
    installCmd: 'pip install itur',
  },
  {
    name: 'ccsds (Java)',
    repo: 'https://github.com/dariol83/ccsds',
    stars: '100+',
    language: 'Java',
    license: 'Apache-2.0',
    tier: 2,
    phases: [3, 4],
    subjects: ['ccsds-framing', 'packet-protocols', 'forward-error-correction'],
    description: 'Most complete open-source CCSDS implementation — TM/TC coding, SLE, CFDP, COP-1, with graphical inspector',
    studyPaths: [
      { path: 'eu.dariolucia.ccsds.tmtc/', description: 'TM frame sync and channel coding with blue book references' },
      { path: 'eu.dariolucia.ccsds.sle.utl/', description: 'Space Link Extension user/provider implementation' },
      { path: 'eu.dariolucia.ccsds.inspector/', description: 'Graphical tool for inspecting TM/TC/AOS/Space Packet streams' },
      { path: 'eu.dariolucia.ccsds.encdec/', description: 'Packet encoding/decoding with ECSS PUS support' },
    ],
  },

  // ── Tier 3: Supplementary References ──
  {
    name: 'orbital_link_budget',
    repo: 'https://github.com/gercunderscore4/orbital_link_budget',
    stars: '<50',
    language: 'Python',
    license: 'MIT',
    tier: 3,
    phases: [1],
    subjects: ['link-budget', 'orbital-mechanics'],
    description: 'Simple LEO link budget calculator from UBC Orbit CubeSat team — good cross-validation reference',
    studyPaths: [],
  },
  {
    name: 'Satellite-Communication-Simulator',
    repo: 'https://github.com/Eniiyanu/Satellite-Communication-Simulator',
    stars: '<50',
    language: 'Python',
    license: 'MIT',
    tier: 3,
    phases: [1],
    subjects: ['link-budget', 'orbital-mechanics'],
    description: 'Minimal Python simulator combining orbital mechanics with path loss and link budget visualization',
    studyPaths: [],
  },
  {
    name: 'sats-receiver',
    repo: 'https://github.com/baskiton/sats-receiver',
    stars: '<50',
    language: 'Python',
    license: 'MIT',
    tier: 3,
    phases: [2],
    subjects: ['gnu-radio', 'ground-station-automation', 'satellite-tracking'],
    description: 'Automated satellite signal receiver with TLE updates, pass prediction, and IQ recording',
    studyPaths: [],
  },
  {
    name: 'sdr-modem',
    repo: 'https://github.com/dernasherbrezon/sdr-modem',
    stars: '<50',
    language: 'C',
    license: 'GPL-3.0',
    tier: 3,
    phases: [4],
    subjects: ['sdr-integration', 'dsp-demodulation'],
    description: 'Lightweight SDR modem — good reference for real hardware challenges (DC offset, sample drops)',
    studyPaths: [],
  },
  {
    name: 'sdr-o-ran-platform',
    repo: 'https://github.com/thc1006/sdr-o-ran-platform',
    stars: '<50',
    language: 'Python',
    license: 'MIT',
    tier: 3,
    phases: [4],
    subjects: ['sdr-integration', 'encryption-security'],
    description: 'SDR + O-RAN for 3GPP NTN with quantum-safe cryptography and deep reinforcement learning',
    studyPaths: [],
  },
  {
    name: 'poliastro',
    repo: 'https://github.com/poliastro/poliastro',
    stars: '800+',
    language: 'Python',
    license: 'MIT',
    tier: 3,
    phases: [1],
    subjects: ['orbital-mechanics'],
    description: 'Full-featured astrodynamics library with orbit propagation, maneuver planning, and 3D visualization',
    studyPaths: [],
  },
  {
    name: 'gnss-sdr',
    repo: 'https://github.com/gnss-sdr/gnss-sdr',
    stars: '1,500+',
    language: 'C++',
    license: 'GPL-3.0',
    tier: 3,
    phases: [3],
    subjects: ['dsp-demodulation', 'forward-error-correction'],
    description: 'Production-grade GNSS receiver — exceptional DSP blocks (Costas loops, DLLs, code/carrier tracking)',
    studyPaths: [],
  },
  {
    name: 'Pypredict',
    repo: 'https://github.com/spel-uchile/Pypredict',
    stars: '<50',
    language: 'Python',
    license: 'GPL-3.0',
    tier: 3,
    phases: [2, 5],
    subjects: ['satellite-tracking', 'orbital-mechanics', 'web-visualization'],
    description: 'Satellite tracker with PyQt5 GUI, TLE management, pass prediction, and ground track plotting',
    studyPaths: [],
  },
  {
    name: 'Satellite-FUN',
    repo: 'https://github.com/SV1CAL/Satellite-FUN',
    stars: '<50',
    language: 'C#',
    license: 'MIT',
    tier: 3,
    phases: [2],
    subjects: ['ground-station-automation', 'sdr-integration', 'satellite-tracking'],
    description: 'Automated satellite pass prediction, SDR recording, rotator control, multi-band ground station',
    studyPaths: [],
  },
  {
    name: 'libccsds',
    repo: 'https://github.com/altillimity/libccsds',
    stars: '<50',
    language: 'C',
    license: 'GPL-3.0',
    tier: 3,
    phases: [3],
    subjects: ['ccsds-framing', 'forward-error-correction'],
    description: 'Standalone C CCSDS library extracted from SatDump — lightweight framing, RS, and Viterbi',
    studyPaths: [],
  },
  {
    name: 'space_packet_parser',
    repo: 'https://github.com/lasp/space_packet_parser',
    stars: '<50',
    language: 'Python',
    license: 'BSD-3',
    tier: 3,
    phases: [3],
    subjects: ['packet-protocols', 'ccsds-framing'],
    description: 'XTCE-based CCSDS packet decoder from LASP — load telemetry definitions from XML',
    studyPaths: [],
  },
]

export const tierLabels: Record<number, string> = {
  1: 'Core Dependencies',
  2: 'Architecture References',
  3: 'Supplementary',
}

export const phaseLabels: Record<number, string> = {
  1: 'Link Budget',
  2: 'Ground Station',
  3: 'CCSDS Modem',
  4: 'Loopback & ICD',
  5: 'Dashboard',
}

export const languageColors: Record<string, string> = {
  'C++': 'bg-pink-900/50 text-pink-300',
  'C': 'bg-gray-700/50 text-gray-300',
  'Python': 'bg-blue-900/50 text-blue-300',
  'Python / C++': 'bg-violet-900/50 text-violet-300',
  'Java': 'bg-orange-900/50 text-orange-300',
  'JavaScript': 'bg-yellow-900/50 text-yellow-300',
  'JavaScript / Python': 'bg-amber-900/50 text-amber-300',
  'C#': 'bg-green-900/50 text-green-300',
}
