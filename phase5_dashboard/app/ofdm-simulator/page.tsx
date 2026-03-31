'use client'

import { useState } from 'react'

/* ── static data ───────────────────────────────────────── */

const implementations = [
  {
    name: 'Python',
    lang: 'Python 3.12',
    purpose: 'Reference prototype + test vector generation',
    status: 'complete' as const,
    tests: '20/20',
    detail: 'LDPC encoder/decoder, OFDM chain, 11 channel models, 3 estimators, interactive Dash dashboard',
    badge: 'bg-yellow-900/40 text-yellow-300 border-yellow-800/50',
  },
  {
    name: 'Rust + SIMD',
    lang: 'Rust (stable)',
    purpose: 'Real-time software decode (~1.5 Mbps)',
    status: 'complete' as const,
    tests: '11/11',
    detail: 'CSR graph, f64 scalar + AVX2/NEON f32 CNU kernel, bit-exact vs Python on all 4 SNR points',
    badge: 'bg-orange-900/40 text-orange-300 border-orange-800/50',
  },
  {
    name: 'FPGA (SystemVerilog)',
    lang: 'Arty A7-100T',
    purpose: 'Full-rate decode (~4.7 Gbps target)',
    status: 'pending' as const,
    tests: '5 TB ready',
    detail: '12 RTL modules, 1,771 lines. 6-bit datapath, barrel shifter CNU, zero DSP slices. Awaiting Icarus Verilog',
    badge: 'bg-violet-900/40 text-violet-300 border-violet-800/50',
  },
]

const pythonTests = [
  { phase: 'P1', name: 'Code Definition', checks: 8, pass: 8, detail: 'H shape, rate, weights, edges, Tanner bidirectional, GF(2) rank' },
  { phase: 'P2', name: 'Encoder', checks: 3, pass: 3, detail: '1000 random codewords, Gaussian cross-check, all-zero' },
  { phase: 'P3', name: 'Channel', checks: 5, pass: 5, detail: 'BPSK mapping, noise variance 0.04% error, LLR monotonicity' },
  { phase: 'P4', name: 'Decoder', checks: 5, pass: 5, detail: 'Noiseless 1-iter, clean 12-iter, noisy 50-iter, iteration capture' },
  { phase: 'P5', name: 'BER Sweep', checks: 10, pass: 10, detail: 'Waterfall from 2.6e-1 (-3 dB) to 0 (3 dB), 100 trials/point' },
  { phase: 'P6', name: 'Test Vectors', checks: 6, pass: 6, detail: 'JSON, binary f32, 6-bit hex round-trip, iteration snapshots' },
]

const rustTests = [
  { name: 'Code JSON loading', pass: true },
  { name: 'Graph construction matches Python', pass: true },
  { name: 'Edge count (2,376)', pass: true },
  { name: 'Bidirectional consistency', pass: true },
  { name: 'Cross-reference roundtrip', pass: true },
  { name: 'Noiseless convergence (1 iter)', pass: true },
  { name: 'Clean SNR bit-exact (+2.0 dB)', pass: true },
  { name: 'Waterfall SNR bit-exact (-0.5 dB)', pass: true },
  { name: 'High noise bit-exact (-2.0 dB)', pass: true },
  { name: 'AVX2 SIMD availability', pass: true },
  { name: 'SIMD CNU matches scalar', pass: true },
]

const berData = [
  { snr: -3.0, ber: '2.61e-1', fer: '1.000', avgIter: 50.0 },
  { snr: -2.0, ber: '2.33e-1', fer: '1.000', avgIter: 50.0 },
  { snr: -1.0, ber: '2.01e-1', fer: '1.000', avgIter: 50.0 },
  { snr: 0.0, ber: '1.50e-1', fer: '0.970', avgIter: 49.4 },
  { snr: 0.5, ber: '1.07e-1', fer: '0.870', avgIter: 47.2 },
  { snr: 1.0, ber: '4.01e-2', fer: '0.440', avgIter: 36.1 },
  { snr: 1.5, ber: '1.23e-2', fer: '0.170', avgIter: 20.8 },
  { snr: 2.0, ber: '3.09e-5', fer: '0.010', avgIter: 11.0 },
  { snr: 2.5, ber: '0.00e+0', fer: '0.000', avgIter: 7.9 },
  { snr: 3.0, ber: '0.00e+0', fer: '0.000', avgIter: 6.5 },
]

const channelBerData = [
  { channel: 'Flat', snr5: '0.005', snr10: '0.000', snr15: '0.000', note: 'AWGN reference' },
  { channel: 'Two-tap', snr5: '0.035', snr10: '0.000', snr15: '0.000', note: 'Main + reflection' },
  { channel: 'TU-6', snr5: '0.155', snr10: '0.033', snr15: '0.079', note: 'ISI floor at FFT=64' },
  { channel: 'COST207-HT', snr5: '0.078', snr10: '0.000', snr15: '0.000', note: 'Hilly terrain' },
  { channel: 'Brazil D', snr5: '0.012', snr10: '0.000', snr15: '0.000', note: 'Mountainous/SFN' },
  { channel: 'Legacy (LS+ZF)', snr5: '0.382', snr10: '0.348', snr15: '0.321', note: 'Permanently broken' },
]

const channelModels = [
  { name: 'flat', taps: 1, delay: '0 us', desc: 'Single tap, AWGN reference' },
  { name: 'two_tap', taps: 2, delay: '0.83 us', desc: 'Main + reflection at -3 dB' },
  { name: 'tu6', taps: 6, delay: '5.0 us', desc: 'COST207 Typical Urban' },
  { name: 'cost207_ra', taps: 6, delay: '0.5 us', desc: 'COST207 Rural Area' },
  { name: 'cost207_ht', taps: 6, delay: '5.0 us', desc: 'COST207 Hilly Terrain' },
  { name: 'brazil_a', taps: 3, delay: '2.22 us', desc: 'Brazil indoor reception' },
  { name: 'brazil_b', taps: 5, delay: '9.5 us', desc: 'Brazil outdoor pedestrian' },
  { name: 'brazil_c', taps: 6, delay: '2.8 us', desc: 'Brazil vehicular urban' },
  { name: 'brazil_d', taps: 6, delay: '20.0 us', desc: 'Brazil mountainous / SFN' },
  { name: 'brazil_e', taps: 6, delay: '23.0 us', desc: 'Brazil SFN equal-power' },
]

const fftSizes = [
  { fft: 64, cp: 16, pilots: 13, data: 39, maxTaps: 16 },
  { fft: 256, cp: 64, pilots: 52, data: 156, maxTaps: 64 },
  { fft: 8192, cp: 2048, pilots: 1704, data: 5113, maxTaps: 2048 },
]

const benchmarks = [
  { scenario: 'Clean (+2.0 dB)', time: '424 us', iters: 12, throughput: '~1.53 Mbps' },
  { scenario: 'High noise (-2.0 dB)', time: '1.74 ms', iters: 50, throughput: '~372 kbps' },
]

const hardwareComparison = [
  { name: 'RTL-SDR v4', freq: '24-1766 MHz', bw: '2.4 MHz', bits: 8, price: '~$30', verdict: 'Too narrow for 6 MHz ATSC 3.0' },
  { name: 'SDRplay RSP1B', freq: '1 kHz-2 GHz', bw: '10 MHz', bits: 14, price: '~$120', verdict: 'Recommended — 14-bit, covers 6 MHz' },
  { name: 'HackRF One', freq: '1-6000 MHz', bw: '20 MHz', bits: 8, price: '~$350', verdict: '8-bit limits SNR for high-order QAM' },
  { name: 'Adalm-Pluto', freq: '325-3800 MHz', bw: '20 MHz', bits: 12, price: '~$200', verdict: '325 MHz low cutoff marginal for low UHF' },
]

const roadmapStages = [
  { stage: 0, name: 'Baseband BPSK + AWGN', status: 'done' as const, desc: 'LDPC encode/decode through flat AWGN. Python + Rust + FPGA RTL.' },
  { stage: 1, name: 'OFDM + Flat AWGN', status: 'done' as const, desc: 'Full OFDM chain: QAM, IFFT+CP, AWGN, FFT, equalization, LLR → LDPC.' },
  { stage: 2, name: 'OFDM + Multipath Fading', status: 'done' as const, desc: 'COST207, Brazil DTV models, Rayleigh/Rician fading, LMMSE estimation.' },
  { stage: 3, name: 'Recorded IQ Playback', status: 'next' as const, desc: 'Load .raw/.cf32 IQ files from real ATSC 3.0 broadcasts.' },
  { stage: 4, name: 'Live SDR Capture', status: 'future' as const, desc: 'Real-time IQ from SDRplay RSP1B → streaming OFDM demod + LDPC decode.' },
  { stage: 5, name: 'GNU Radio Integration', status: 'future' as const, desc: 'LDPC decoder as GNU Radio OOT module, full ATSC 3.0 protocol stack.' },
]

const docs = [
  { name: 'Technical Report', href: '/ofdm-report/index.html', desc: 'Complete report with SVG plots, architecture diagrams, all test data' },
  { name: 'Channel Estimation Math', href: '/ofdm-report/channel_estimation_math.html', desc: 'Full LMMSE derivation, subcarrier maps, ZF vs MMSE comparison' },
]

/* ── helpers ───────────────────────────────────────────── */

function StatusDot({ status }: { status: 'complete' | 'pending' | 'done' | 'next' | 'future' }) {
  const cls: Record<string, string> = {
    complete: 'bg-emerald-400',
    done: 'bg-emerald-400',
    pending: 'bg-amber-400 animate-pulse',
    next: 'bg-blue-400',
    future: 'bg-gray-600',
  }
  return <span className={`inline-block w-2 h-2 rounded-full ${cls[status]}`} />
}

type Tab = 'overview' | 'tests' | 'ber' | 'ofdm' | 'hardware'

/* ── page ──────────────────────────────────────────────── */

export default function OfdmSimulatorPage() {
  const [tab, setTab] = useState<Tab>('overview')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'tests', label: 'Tests & Validation' },
    { id: 'ber', label: 'BER Performance' },
    { id: 'ofdm', label: 'OFDM System' },
    { id: 'hardware', label: 'Hardware & Roadmap' },
  ]

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">OFDM Transceiver Simulator</h1>
        <p className="text-gray-400 text-sm">
          ATSC 3.0 LDPC decoder with OFDM simulation — Python reference, Rust SIMD, FPGA RTL
        </p>
        <p className="text-gray-500 text-xs mt-1 font-mono">D:\OFDM_transceiver_simulator</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
          <div className="text-xs text-gray-500">Python Tests</div>
          <div className="text-xl font-bold text-emerald-400">20/20</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
          <div className="text-xs text-gray-500">Rust Tests</div>
          <div className="text-xl font-bold text-emerald-400">11/11</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
          <div className="text-xs text-gray-500">Cross-validation</div>
          <div className="text-xl font-bold text-emerald-400">4/4 bit-exact</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
          <div className="text-xs text-gray-500">FPGA RTL</div>
          <div className="text-xl font-bold text-amber-400">3,053 lines</div>
          <div className="text-[10px] text-gray-500">Awaiting simulator</div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 overflow-x-auto border-b border-gray-800 pb-px">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`text-sm px-4 py-2 rounded-t-lg transition-colors whitespace-nowrap cursor-pointer ${
              tab === t.id
                ? 'bg-gray-900 text-white border border-gray-800 border-b-gray-950 -mb-px'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {/* Architecture */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Signal Chain</h2>
            <div className="font-mono text-xs text-gray-400 overflow-x-auto whitespace-pre">
{`SDR (RSP1B) → GNU Radio OFDM Demod → QAM Demapper → `}<span className="text-emerald-400 font-bold">[LDPC Decoder]</span>{` → BCH → ALP → HEVC → Display
                                                        ^^^^^^^^^^^^^^
                                                        THIS PROJECT`}
            </div>
          </div>

          {/* Algorithm */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Algorithm: Normalized Min-Sum (NMS)</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-gray-400 mb-2">LDPC Code Parameters</div>
                <table className="w-full text-xs">
                  <tbody>
                    {[
                      ['Dev code', '802.11n rate-1/2, N=648, Z=27'],
                      ['ATSC 3.0', 'N=16,200 / 64,800, Z=360'],
                      ['Code rates', '2/15 through 13/15 (12 rates)'],
                      ['Alpha', '0.75 (~0.2 dB from BP)'],
                      ['Max iterations', '50'],
                      ['Early termination', 'Syndrome check'],
                    ].map(([k, v]) => (
                      <tr key={k} className="border-b border-gray-800/50">
                        <td className="py-1 text-gray-500 w-32">{k}</td>
                        <td className="py-1 font-mono text-gray-300">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <div className="text-gray-400 mb-2">Decoder Flow</div>
                <div className="text-xs text-gray-400 space-y-1 font-mono">
                  <p><span className="text-blue-400">VNU:</span> posterior = channel_LLR + sum(c2v)</p>
                  <p><span className="text-blue-400">CNU:</span> min-sum approx + alpha scaling</p>
                  <p><span className="text-blue-400">Check:</span> syndrome = 0 → early stop</p>
                  <p className="text-gray-500 mt-2">Alpha=0.75 = 1-1/4 = x-(x&gt;&gt;2) → zero DSP slices on FPGA</p>
                </div>
              </div>
            </div>
          </div>

          {/* Implementations */}
          <div>
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Implementations</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {implementations.map(impl => (
                <div key={impl.name} className="bg-gray-900 rounded-lg border border-gray-800 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <StatusDot status={impl.status} />
                    <span className="font-semibold text-white">{impl.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ml-auto ${impl.badge}`}>
                      {impl.lang}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 mb-2">{impl.purpose}</p>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-mono text-emerald-400">{impl.tests} pass</span>
                  </div>
                  <p className="text-xs text-gray-500">{impl.detail}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Documentation links */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Documentation</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {docs.map(d => (
                <a
                  key={d.name}
                  href={d.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block bg-gray-800/50 rounded-lg p-3 border border-gray-700/50 hover:border-emerald-800/50 transition-colors"
                >
                  <div className="text-sm font-semibold text-emerald-400">{d.name}</div>
                  <div className="text-xs text-gray-400 mt-1">{d.desc}</div>
                </a>
              ))}
            </div>
          </div>

          {/* Quick start */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Quick Start</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
              <div>
                <div className="text-yellow-300 mb-1">Python</div>
                <pre className="text-gray-400 whitespace-pre-wrap">{`cd python
pip install -r requirements.txt
python test_ber.py
python -m ofdm.simulation
python run_dashboard.py`}</pre>
              </div>
              <div>
                <div className="text-orange-300 mb-1">Rust</div>
                <pre className="text-gray-400 whitespace-pre-wrap">{`cd rust
cargo test
cargo run --release
cargo bench`}</pre>
              </div>
              <div>
                <div className="text-violet-300 mb-1">FPGA</div>
                <pre className="text-gray-400 whitespace-pre-wrap">{`cd fpga/sim
make all
# requires iverilog`}</pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TESTS & VALIDATION ──────────────────────── */}
      {tab === 'tests' && (
        <div className="space-y-6">
          {/* Python tests */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">
              Python Reference — 20/20 <span className="text-emerald-400 font-mono">PASS</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left py-1.5 pr-3">Phase</th>
                    <th className="text-left py-1.5 pr-3">Component</th>
                    <th className="text-left py-1.5 pr-3">Result</th>
                    <th className="text-left py-1.5">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {pythonTests.map(t => (
                    <tr key={t.phase} className="border-b border-gray-800/50">
                      <td className="py-1.5 pr-3 font-mono text-blue-400">{t.phase}</td>
                      <td className="py-1.5 pr-3 text-gray-300">{t.name}</td>
                      <td className="py-1.5 pr-3 font-mono text-emerald-400">{t.pass}/{t.checks}</td>
                      <td className="py-1.5 text-gray-500">{t.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Rust tests */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">
              Rust Port — 11/11 <span className="text-emerald-400 font-mono">PASS</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
              {rustTests.map(t => (
                <div key={t.name} className="flex items-center gap-2 py-1 border-b border-gray-800/30 text-xs">
                  <span className="text-emerald-400 font-mono w-4">ok</span>
                  <span className="text-gray-300">{t.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Cross-validation */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Cross-validation Matrix</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left py-1.5 pr-4">Test Vector</th>
                    <th className="text-left py-1.5 pr-4">Python</th>
                    <th className="text-left py-1.5 pr-4">Rust</th>
                    <th className="text-left py-1.5">FPGA (6-bit)</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['noiseless (inf dB)', 'generated', 'bit-exact PASS', 'awaiting sim'],
                    ['clean (+2.0 dB)', 'generated', 'bit-exact PASS', 'awaiting sim'],
                    ['waterfall (-0.5 dB)', 'generated', 'bit-exact PASS', 'awaiting sim'],
                    ['high_noise (-2.0 dB)', 'generated', 'bit-exact PASS', 'awaiting sim'],
                  ].map(([vec, py, rs, fpga]) => (
                    <tr key={vec} className="border-b border-gray-800/50">
                      <td className="py-1.5 pr-4 font-mono text-gray-300">{vec}</td>
                      <td className="py-1.5 pr-4 text-yellow-300">{py}</td>
                      <td className="py-1.5 pr-4 text-emerald-400">{rs}</td>
                      <td className="py-1.5 text-amber-400">{fpga}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-gray-500 mt-2">
              Bit-exact: given identical f32 LLRs, Python and Rust produce identical decoded bits, even on non-converging frames.
            </p>
          </div>

          {/* Rust benchmarks */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Rust Benchmarks (Criterion)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left py-1.5 pr-4">Scenario</th>
                    <th className="text-left py-1.5 pr-4">Time/frame</th>
                    <th className="text-left py-1.5 pr-4">Iterations</th>
                    <th className="text-left py-1.5">Throughput</th>
                  </tr>
                </thead>
                <tbody>
                  {benchmarks.map(b => (
                    <tr key={b.scenario} className="border-b border-gray-800/50">
                      <td className="py-1.5 pr-4 text-gray-300">{b.scenario}</td>
                      <td className="py-1.5 pr-4 font-mono text-blue-400">{b.time}</td>
                      <td className="py-1.5 pr-4 font-mono text-gray-400">{b.iters}</td>
                      <td className="py-1.5 font-mono text-emerald-400">{b.throughput}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-gray-500 mt-2">~500x faster than Python reference (native loops + CSR cache locality vs per-edge Python interpreter calls)</p>
          </div>

          {/* Key tradeoffs */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Key Tradeoffs Discovered</h2>
            <div className="space-y-3 text-xs">
              {[
                { title: 'Encoder pre-computation', detail: 'O(M³) per-frame → O(M·K) one-time inverse. 1000-frame test: timeout → 3 seconds.' },
                { title: 'f64 vs f32 precision', detail: 'Rust uses f64 internally for bit-exact match. f32 diverges on non-converging frames after 50 iterations.' },
                { title: 'Min-Sum alpha=0.75', detail: '~0.2 dB from belief propagation. x-(x>>2) on FPGA = zero DSP slices. Gap recovered by +0.5 iterations.' },
                { title: '6-bit quantization', detail: 'Clip to [-31,+31] avoids asymmetric -32 in 2\'s complement. Matches FPGA datapath exactly.' },
                { title: 'Test trials (100/point)', detail: 'Sufficient for waterfall shape. Error floor characterization needs 10K+ trials → use Rust CLI.' },
              ].map(t => (
                <div key={t.title} className="border-l-2 border-gray-700 pl-3">
                  <div className="text-gray-300 font-medium">{t.title}</div>
                  <div className="text-gray-500">{t.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── BER PERFORMANCE ─────────────────────────── */}
      {tab === 'ber' && (
        <div className="space-y-6">
          {/* BER waterfall table */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-1">BER Waterfall — BPSK, AWGN, 802.11n rate-1/2</h2>
            <p className="text-[10px] text-gray-500 mb-3">100 trials per point, max 50 iterations, NMS alpha=0.75</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-right py-1.5 pr-4">SNR (dB)</th>
                    <th className="text-right py-1.5 pr-4">BER</th>
                    <th className="text-right py-1.5 pr-4">FER</th>
                    <th className="text-right py-1.5 pr-4">Avg Iters</th>
                    <th className="text-left py-1.5">Region</th>
                  </tr>
                </thead>
                <tbody>
                  {berData.map(d => {
                    const region = d.snr < 0 ? 'Noise floor' : d.snr < 2 ? 'Waterfall' : 'Error-free'
                    const regionColor = d.snr < 0 ? 'text-red-400' : d.snr < 2 ? 'text-amber-400' : 'text-emerald-400'
                    return (
                      <tr key={d.snr} className="border-b border-gray-800/50">
                        <td className="text-right py-1.5 pr-4 font-mono text-gray-300">{d.snr.toFixed(1)}</td>
                        <td className="text-right py-1.5 pr-4 font-mono text-gray-300">{d.ber}</td>
                        <td className="text-right py-1.5 pr-4 font-mono text-gray-400">{d.fer}</td>
                        <td className="text-right py-1.5 pr-4 font-mono text-gray-400">{d.avgIter}</td>
                        <td className={`py-1.5 ${regionColor}`}>{region}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Channel comparison */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-1">Channel Comparison — QPSK, LMMSE+MMSE, FFT=64</h2>
            <p className="text-[10px] text-gray-500 mb-3">BER at selected SNR points (3 seeds averaged)</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left py-1.5 pr-3">Channel</th>
                    <th className="text-right py-1.5 pr-3">5 dB</th>
                    <th className="text-right py-1.5 pr-3">10 dB</th>
                    <th className="text-right py-1.5 pr-3">15 dB</th>
                    <th className="text-left py-1.5">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {channelBerData.map(d => {
                    const broken = d.channel === 'Legacy (LS+ZF)'
                    return (
                      <tr key={d.channel} className={`border-b border-gray-800/50 ${broken ? 'bg-red-900/10' : ''}`}>
                        <td className={`py-1.5 pr-3 font-mono ${broken ? 'text-red-400' : 'text-gray-300'}`}>{d.channel}</td>
                        <td className="text-right py-1.5 pr-3 font-mono text-gray-400">{d.snr5}</td>
                        <td className="text-right py-1.5 pr-3 font-mono text-gray-400">{d.snr10}</td>
                        <td className={`text-right py-1.5 pr-3 font-mono ${broken ? 'text-red-400' : 'text-gray-400'}`}>{d.snr15}</td>
                        <td className="py-1.5 text-gray-500">{d.note}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* FFT size impact */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-1">FFT Size Impact on TU-6</h2>
            <p className="text-[10px] text-gray-500 mb-3">Larger FFT = more pilots = better estimation = lower BER</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left py-1.5 pr-3">FFT</th>
                    <th className="text-right py-1.5 pr-3">CP</th>
                    <th className="text-right py-1.5 pr-3">Pilots</th>
                    <th className="text-right py-1.5 pr-3">10 dB</th>
                    <th className="text-right py-1.5 pr-3">15 dB</th>
                    <th className="text-left py-1.5">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { fft: '64', cp: '16', pilots: '13', snr10: '0.033', snr15: '0.079', note: 'ISI floor (delay > CP)' },
                    { fft: '256', cp: '64', pilots: '52', snr10: '0.000', snr15: '0.000', note: 'Clean waterfall' },
                    { fft: '8192', cp: '2048', pilots: '1704', snr10: '0.000', snr15: '0.000', note: '1-iter convergence' },
                    { fft: 'Legacy', cp: '16', pilots: '4', snr10: '0.348', snr15: '0.321', note: 'Permanently broken' },
                  ].map(d => {
                    const broken = d.fft === 'Legacy'
                    return (
                      <tr key={d.fft} className={`border-b border-gray-800/50 ${broken ? 'bg-red-900/10' : ''}`}>
                        <td className={`py-1.5 pr-3 font-mono ${broken ? 'text-red-400' : 'text-gray-300'}`}>{d.fft}</td>
                        <td className="text-right py-1.5 pr-3 font-mono text-gray-400">{d.cp}</td>
                        <td className="text-right py-1.5 pr-3 font-mono text-gray-400">{d.pilots}</td>
                        <td className={`text-right py-1.5 pr-3 font-mono ${broken ? 'text-red-400' : 'text-gray-400'}`}>{d.snr10}</td>
                        <td className={`text-right py-1.5 pr-3 font-mono ${broken ? 'text-red-400' : 'text-gray-400'}`}>{d.snr15}</td>
                        <td className="py-1.5 text-gray-500">{d.note}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* BER Charts */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">BER Charts</h2>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(n => (
                <div key={n} className="bg-gray-800/50 rounded-lg p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/ofdm-report/ber_chart_${n}.svg`}
                    alt={`BER chart ${n}`}
                    className="w-full rounded"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── OFDM SYSTEM ─────────────────────────────── */}
      {tab === 'ofdm' && (
        <div className="space-y-6">
          {/* FFT sizes */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Multi-FFT Support</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left py-1.5 pr-4">FFT Size</th>
                    <th className="text-right py-1.5 pr-4">CP</th>
                    <th className="text-right py-1.5 pr-4">Pilots</th>
                    <th className="text-right py-1.5 pr-4">Data Carriers</th>
                    <th className="text-right py-1.5">Max Channel Taps</th>
                  </tr>
                </thead>
                <tbody>
                  {fftSizes.map(f => (
                    <tr key={f.fft} className="border-b border-gray-800/50">
                      <td className="py-1.5 pr-4 font-mono text-gray-300">{f.fft.toLocaleString()}</td>
                      <td className="text-right py-1.5 pr-4 font-mono text-gray-400">{f.cp}</td>
                      <td className="text-right py-1.5 pr-4 font-mono text-gray-400">{f.pilots}</td>
                      <td className="text-right py-1.5 pr-4 font-mono text-gray-400">{f.data}</td>
                      <td className="text-right py-1.5 font-mono text-gray-400">{f.maxTaps}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-gray-500 mt-2">ATSC 3.0 uses 8K/16K/32K FFT. Larger FFT = more pilots = better channel estimation.</p>
          </div>

          {/* Estimation & Equalization */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
              <h2 className="text-sm font-semibold text-gray-300 mb-3">Channel Estimation</h2>
              <div className="space-y-3 text-xs">
                <div className="border-l-2 border-red-800 pl-3">
                  <div className="text-red-400 font-medium">LS (legacy)</div>
                  <div className="text-gray-500">Magnitude/phase interpolation, 4 pilots. Fails on multipath.</div>
                </div>
                <div className="border-l-2 border-amber-800 pl-3">
                  <div className="text-amber-400 font-medium">LS-Improved</div>
                  <div className="text-gray-500">Re/Im linear interpolation, 13+ pilots. Works on simple channels.</div>
                </div>
                <div className="border-l-2 border-emerald-800 pl-3">
                  <div className="text-emerald-400 font-medium">LMMSE (DFT-based)</div>
                  <div className="text-gray-500">Tikhonov-regularized DFT estimation (Edfors et al., 1998). Best on all channels.</div>
                </div>
              </div>
              <div className="mt-3 p-2 bg-gray-800/50 rounded text-[10px] font-mono text-gray-400">
                <p>1. LS at pilots: H_ls = Y_p / X_p</p>
                <p>2. Partial DFT: F_p[i,l] = exp(-j2pi*pilot[i]*l/N)</p>
                <p>3. Regularized: h = (F_p^H*F_p + lambda*I)^-1 * F_p^H * H_ls</p>
                <p>4. Reconstruct: H = F_full * h</p>
              </div>
            </div>

            <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
              <h2 className="text-sm font-semibold text-gray-300 mb-3">Equalization</h2>
              <div className="space-y-3 text-xs">
                <div className="border-l-2 border-amber-800 pl-3">
                  <div className="text-amber-400 font-medium">Zero-Forcing</div>
                  <div className="text-gray-500">X = Y / H — amplifies noise at frequency nulls</div>
                </div>
                <div className="border-l-2 border-emerald-800 pl-3">
                  <div className="text-emerald-400 font-medium">MMSE</div>
                  <div className="text-gray-500">X = H*Y / (|H|² + sigma²) — bounded noise, always stable</div>
                </div>
              </div>

              <h2 className="text-sm font-semibold text-gray-300 mt-6 mb-3">Modulations</h2>
              <div className="flex gap-2 flex-wrap">
                {['QPSK', '16-QAM', '64-QAM'].map(m => (
                  <span key={m} className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-300 border border-gray-700">
                    {m}
                  </span>
                ))}
              </div>

              <h2 className="text-sm font-semibold text-gray-300 mt-6 mb-3">Fading Modes</h2>
              <div className="flex gap-2 flex-wrap">
                {['None (deterministic)', 'Rayleigh', 'Rician (K-factor)'].map(f => (
                  <span key={f} className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-300 border border-gray-700">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Channel models */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Channel Models (11 variants)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left py-1.5 pr-4">Model</th>
                    <th className="text-right py-1.5 pr-4">Taps</th>
                    <th className="text-left py-1.5 pr-4">Max Delay</th>
                    <th className="text-left py-1.5">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {channelModels.map(m => (
                    <tr key={m.name} className="border-b border-gray-800/50">
                      <td className="py-1.5 pr-4 font-mono text-cyan-400">{m.name}</td>
                      <td className="text-right py-1.5 pr-4 font-mono text-gray-400">{m.taps}</td>
                      <td className="py-1.5 pr-4 font-mono text-gray-400">{m.delay}</td>
                      <td className="py-1.5 text-gray-500">{m.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* FPGA architecture */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">FPGA RTL Architecture</h2>
            <pre className="font-mono text-[10px] text-gray-400 overflow-x-auto whitespace-pre mb-4">{`                    +------------------+
  LLR in --------->| llr_input_buffer |----+
  (AXI-S)          +------------------+    |
                                           v
  +------------------+    +-----------+   +-----------+
  | base_matrix_rom  |--->| barrel    |-->| check     |
  | (shift values)   |    | shifter   |   | node unit |
  +------------------+    +-----------+   +-----------+
                                               |
                            +-----------+      |  c2v messages
                            | message   |<-----+
                            | ram       |
                            +-----------+
                                 |
                            +-----------+   +-----------+
                            | variable  |-->| syndrome  |
                            | node unit |   | checker   |
                            +-----------+   +-----------+
                                 |               |
                            +-----------+   converged?
                            | output    |      |
  decoded out <-------------|  buffer   |   +----------+
  (AXI-S)                   +-----------+   | iter     |
                                            | ctrl FSM |
                                            +----------+`}</pre>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <div className="text-gray-500">Target</div>
                <div className="font-mono text-violet-400">Arty A7-100T</div>
              </div>
              <div>
                <div className="text-gray-500">Datapath</div>
                <div className="font-mono text-gray-300">6-bit signed</div>
              </div>
              <div>
                <div className="text-gray-500">DSP Slices</div>
                <div className="font-mono text-emerald-400">0 (shift-based)</div>
              </div>
              <div>
                <div className="text-gray-500">RTL Lines</div>
                <div className="font-mono text-gray-300">1,771 + 1,282 TB</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── HARDWARE & ROADMAP ──────────────────────── */}
      {tab === 'hardware' && (
        <div className="space-y-6">
          {/* ATSC 3.0 specs */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">ATSC 3.0 RF Specifications</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
              {[
                ['Frequency', 'UHF 470-698 MHz'],
                ['Bandwidth', '6 MHz (North America)'],
                ['FFT sizes', '8K, 16K, 32K'],
                ['Modulations', 'QPSK to 4096-QAM'],
                ['LDPC lengths', '16,200 / 64,800'],
                ['Code rates', '2/15 to 13/15'],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="text-gray-500">{k}</div>
                  <div className="font-mono text-gray-300">{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* SDR comparison */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">SDR Hardware Comparison</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left py-1.5 pr-3">SDR</th>
                    <th className="text-left py-1.5 pr-3">Freq Range</th>
                    <th className="text-right py-1.5 pr-3">BW</th>
                    <th className="text-right py-1.5 pr-3">ADC</th>
                    <th className="text-right py-1.5 pr-3">Price</th>
                    <th className="text-left py-1.5">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {hardwareComparison.map(h => {
                    const recommended = h.name === 'SDRplay RSP1B'
                    return (
                      <tr key={h.name} className={`border-b border-gray-800/50 ${recommended ? 'bg-emerald-900/10' : ''}`}>
                        <td className={`py-1.5 pr-3 font-mono ${recommended ? 'text-emerald-400' : 'text-gray-300'}`}>{h.name}</td>
                        <td className="py-1.5 pr-3 text-gray-400">{h.freq}</td>
                        <td className="text-right py-1.5 pr-3 font-mono text-gray-400">{h.bw}</td>
                        <td className="text-right py-1.5 pr-3 font-mono text-gray-400">{h.bits}-bit</td>
                        <td className="text-right py-1.5 pr-3 font-mono text-gray-300">{h.price}</td>
                        <td className={`py-1.5 ${recommended ? 'text-emerald-400' : 'text-gray-500'}`}>{h.verdict}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Cost summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['SDRplay RSP1B', '~$120'],
              ['F-to-SMA adapter', '~$5'],
              ['UHF antenna', '~$20-40'],
              ['Total minimum', '~$145-165'],
            ].map(([item, price]) => (
              <div key={item} className="bg-gray-900 rounded-lg p-3 border border-gray-800">
                <div className="text-xs text-gray-500">{item}</div>
                <div className={`text-lg font-bold font-mono ${item === 'Total minimum' ? 'text-emerald-400' : 'text-gray-300'}`}>{price}</div>
              </div>
            ))}
          </div>

          {/* Roadmap */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-4">Roadmap: Simulation to Real RF</h2>
            <div className="space-y-3">
              {roadmapStages.map(s => (
                <div key={s.stage} className="flex items-start gap-3">
                  <div className="flex items-center gap-2 shrink-0 w-24">
                    <StatusDot status={s.status} />
                    <span className="text-xs font-mono text-gray-400">Stage {s.stage}</span>
                  </div>
                  <div>
                    <div className="text-sm text-gray-200 font-medium">{s.name}</div>
                    <div className="text-xs text-gray-500">{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* References */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Academic References</h2>
            <div className="space-y-1.5 text-xs text-gray-400">
              <p>Edfors et al., &ldquo;OFDM Channel Estimation by Singular Value Decomposition,&rdquo; IEEE Trans. Comm., 1998</p>
              <p>Coleri et al., &ldquo;Channel Estimation Techniques Based on Pilot Arrangement in OFDM Systems,&rdquo; IEEE Trans. Broadcasting, 2002</p>
              <p>van de Beek et al., &ldquo;On Channel Estimation in OFDM Systems,&rdquo; IEEE VTC, 1995</p>
              <p>COST207, &ldquo;Digital Land Mobile Radio Communications,&rdquo; 1989</p>
              <p>Clarke, &ldquo;A Statistical Theory of Mobile Radio Reception,&rdquo; Bell System Tech Journal, 1968</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
