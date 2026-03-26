import { SignalQuality } from '@/lib/types'

const levels = {
  good: 'bg-emerald-900/50 border-emerald-700 text-emerald-300',
  moderate: 'bg-amber-900/50 border-amber-700 text-amber-300',
  poor: 'bg-red-900/50 border-red-700 text-red-300',
}

function getLevel(q: SignalQuality): keyof typeof levels {
  if (q.snrDb > 10 && q.lockPercentage > 90) return 'good'
  if (q.snrDb >= 5 && q.lockPercentage >= 70) return 'moderate'
  return 'poor'
}

export default function SignalQualityBadge({ quality }: { quality: SignalQuality }) {
  const level = getLevel(quality)
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${levels[level]}`}>
      {quality.snrDb.toFixed(1)} dB / {quality.lockPercentage}%
    </span>
  )
}
