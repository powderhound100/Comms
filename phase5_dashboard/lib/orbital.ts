const R_EARTH = 6371

export function lookAnglesGeo(
  satLonDeg: number,
  gsLatDeg: number,
  gsLonDeg: number
): { azDeg: number; elDeg: number } {
  const lat = (gsLatDeg * Math.PI) / 180
  const dlon = ((satLonDeg - gsLonDeg) * Math.PI) / 180
  const cosRel = Math.cos(lat) * Math.cos(dlon)
  const rGeo = 42164

  const el = Math.atan2(
    cosRel - R_EARTH / rGeo,
    Math.sqrt(1 - cosRel * cosRel)
  )

  const dlonDeg = satLonDeg - gsLonDeg
  let azDeg: number
  if (gsLatDeg >= 0) {
    if (dlonDeg < 0) {
      azDeg = 180 + (Math.atan(Math.tan((-dlonDeg * Math.PI) / 180) / Math.sin(lat)) * 180) / Math.PI
    } else {
      azDeg = 180 - (Math.atan(Math.tan((dlonDeg * Math.PI) / 180) / Math.sin(lat)) * 180) / Math.PI
    }
  } else {
    azDeg = 180
  }

  return { azDeg: ((azDeg % 360) + 360) % 360, elDeg: (el * 180) / Math.PI }
}

export function maxDopplerShift(freqHz: number, velocityMps: number): number {
  return (freqHz * velocityMps) / 299792458
}

export function dopplerAtElevation(
  freqHz: number,
  velocityMps: number,
  elevationDeg: number
): number {
  const theta = (elevationDeg * Math.PI) / 180
  return (freqHz * velocityMps * Math.cos(theta)) / 299792458
}
