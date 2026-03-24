import SessionLogTable from '@/components/SessionLogTable'

export default function SessionsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Predicted vs Measured Sessions</h1>
      <p className="text-gray-400 mb-6">
        Reception session log showing Phase 1 predicted C/N₀ against Phase 2 measured values.
        Color coding: green (&lt;1 dB), yellow (1–2 dB), red (&gt;2 dB).
      </p>
      <SessionLogTable />
    </div>
  )
}
