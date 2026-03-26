export default function ICDPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Interface Control Document</h1>
      <p className="text-gray-400 mb-6">GL-ICD-001: GROUNDLINK Space-to-Ground ICD</p>

      <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 space-y-6">
        <section>
          <h2 className="text-lg font-semibold text-emerald-400 mb-2">3. RF Interface</h2>
          <table className="w-full text-sm">
            <tbody>
              <Row label="Downlink Frequency" value="2200 MHz (S-band)" />
              <Row label="Modulation" value="BPSK (primary) / QPSK (secondary)" />
              <Row label="Symbol Rate" value="256,000 sps" />
              <Row label="Pulse Shaping" value="RRC, α = 0.35" />
              <Row label="Occupied Bandwidth" value="345.6 kHz" />
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-emerald-400 mb-2">4. Channel Coding</h2>
          <table className="w-full text-sm">
            <tbody>
              <Row label="Inner Code" value="Convolutional r=1/2, k=7 (CCSDS)" />
              <Row label="Generator G1" value="0x6D (1101101)" />
              <Row label="Generator G2" value="0x4F (1001111)" />
              <Row label="Outer Code" value="RS(255,223) — optional" />
              <Row label="ASM" value="0x1ACFFC1D (32-bit)" />
              <Row label="Randomization" value="CCSDS LFSR (x⁸+x⁷+x⁵+x³+1)" />
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-emerald-400 mb-2">5. Frame Structure</h2>
          <div className="bg-gray-800 rounded p-3 font-mono text-sm overflow-x-auto">
            [ASM 32b][Header 48b][Data Field 8856b][CRC 16b] = 8920 bits (1115 bytes)
          </div>
          <table className="w-full text-sm mt-2">
            <tbody>
              <Row label="Version" value="2 bits — always 00" />
              <Row label="Spacecraft ID" value="10 bits" />
              <Row label="Virtual Channel ID" value="3 bits" />
              <Row label="Frame Counter" value="16 bits (wraps at 65535)" />
              <Row label="CRC" value="CRC-16-CCITT (0x1021)" />
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-emerald-400 mb-2">6. Encryption</h2>
          <table className="w-full text-sm">
            <tbody>
              <Row label="Algorithm" value="AES-256-CTR" />
              <Row label="Key Length" value="256 bits (32 bytes)" />
              <Row label="Nonce" value="16 bytes, random per frame" />
              <Row label="Stack Position" value="Above FEC, below framing" />
            </tbody>
          </table>
        </section>

        <div className="text-sm text-gray-500 mt-4">
          Full ICD document: <code>phase4_loopback/icd/GL-ICD-001_Space_Ground.md</code>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-gray-800/50">
      <td className="py-1.5 text-gray-400 w-48">{label}</td>
      <td className="py-1.5 font-mono">{value}</td>
    </tr>
  )
}
