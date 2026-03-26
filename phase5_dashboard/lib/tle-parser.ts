export interface TLEData {
  name: string
  line1: string
  line2: string
  noradId: number
  inclination: number
  eccentricity: number
  meanMotion: number
  epoch: string
}

export function parseTLE(text: string): TLEData[] {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const results: TLEData[] = []

  for (let i = 0; i < lines.length - 2; i += 3) {
    const name = lines[i]
    const line1 = lines[i + 1]
    const line2 = lines[i + 2]

    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue

    const noradId = parseInt(line1.substring(2, 7))
    const inclination = parseFloat(line2.substring(8, 16))
    const eccentricity = parseFloat('0.' + line2.substring(26, 33))
    const meanMotion = parseFloat(line2.substring(52, 63))

    const epochYear = parseInt(line1.substring(18, 20))
    const epochDay = parseFloat(line1.substring(20, 32))
    const fullYear = epochYear > 56 ? 1900 + epochYear : 2000 + epochYear

    results.push({
      name,
      line1,
      line2,
      noradId,
      inclination,
      eccentricity,
      meanMotion,
      epoch: `${fullYear}-day${Math.floor(epochDay)}`,
    })
  }

  return results
}
