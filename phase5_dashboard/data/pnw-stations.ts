/** PNW airports and ADS-B ground stations for map overlay */

export interface MapStation {
  id: string
  name: string
  type: 'airport' | 'gbt'  // airport or ADS-B ground-based transceiver
  lat: number
  lon: number
  code?: string   // ICAO or FAA code
  info?: string   // runway length, elevation, etc.
}

export const pnwAirports: MapStation[] = [
  // Major
  { id: 'KSEA', name: 'Seattle-Tacoma Intl', type: 'airport', lat: 47.4502, lon: -122.3088, code: 'KSEA', info: 'Class B, 11901 ft' },
  { id: 'KPDX', name: 'Portland Intl', type: 'airport', lat: 45.5887, lon: -122.5975, code: 'KPDX', info: 'Class C, 11000 ft' },
  { id: 'KBFI', name: 'Boeing Field', type: 'airport', lat: 47.5300, lon: -122.3019, code: 'KBFI', info: 'Class D, 10000 ft' },
  { id: 'KPAE', name: 'Paine Field', type: 'airport', lat: 47.9063, lon: -122.2815, code: 'KPAE', info: 'Class D, 9010 ft' },
  // Regional / GA
  { id: 'KRNT', name: 'Renton Municipal', type: 'airport', lat: 47.4930, lon: -122.2159, code: 'KRNT', info: 'Class D, 5382 ft' },
  { id: 'S43', name: 'Harvey Field', type: 'airport', lat: 48.0582, lon: -122.1970, code: 'S43', info: 'GA, 2700 ft' },
  { id: 'KAWO', name: 'Arlington Municipal', type: 'airport', lat: 48.1607, lon: -122.1590, code: 'KAWO', info: 'GA, 5332 ft' },
  { id: 'KTIW', name: 'Tacoma Narrows', type: 'airport', lat: 47.2679, lon: -122.5781, code: 'KTIW', info: 'GA, 5002 ft' },
  { id: 'KOLM', name: 'Olympia Regional', type: 'airport', lat: 46.9694, lon: -122.9025, code: 'KOLM', info: 'Class D, 5500 ft' },
  { id: 'KBVS', name: 'Skagit Regional', type: 'airport', lat: 48.4708, lon: -122.4208, code: 'KBVS', info: 'GA, 5477 ft' },
  { id: 'KBLI', name: 'Bellingham Intl', type: 'airport', lat: 48.7927, lon: -122.5375, code: 'KBLI', info: 'Class D, 6701 ft' },
  { id: 'KSHN', name: 'Sanderson Field', type: 'airport', lat: 47.2336, lon: -123.1476, code: 'KSHN', info: 'GA, 4502 ft' },
  { id: 'KTCM', name: 'McChord AFB / JBLM', type: 'airport', lat: 47.1377, lon: -122.4765, code: 'KTCM', info: 'Military, 10108 ft' },
  { id: 'KNUW', name: 'NAS Whidbey Island', type: 'airport', lat: 48.3518, lon: -122.6558, code: 'KNUW', info: 'Military, 8000 ft' },
  { id: 'KHQM', name: 'Bowerman Field', type: 'airport', lat: 46.9712, lon: -123.9366, code: 'KHQM', info: 'GA, 4400 ft' },
  { id: 'KELN', name: 'Ellensburg Bowers', type: 'airport', lat: 47.0330, lon: -120.5306, code: 'KELN', info: 'GA, 4200 ft' },
]

/** FAA ADS-B ground-based transceivers (GBTs) in PNW region.
 *  These receive 978 MHz UAT and rebroadcast on 1090 MHz (ADS-R). */
export const pnwGroundStations: MapStation[] = [
  { id: 'GBT-SEA', name: 'Seattle GBT', type: 'gbt', lat: 47.45, lon: -122.31, info: '1090/978 MHz' },
  { id: 'GBT-PAE', name: 'Paine Field GBT', type: 'gbt', lat: 47.91, lon: -122.28, info: '1090/978 MHz' },
  { id: 'GBT-OLM', name: 'Olympia GBT', type: 'gbt', lat: 46.97, lon: -122.90, info: '1090/978 MHz' },
  { id: 'GBT-BLI', name: 'Bellingham GBT', type: 'gbt', lat: 48.79, lon: -122.54, info: '1090/978 MHz' },
  { id: 'GBT-PDX', name: 'Portland GBT', type: 'gbt', lat: 45.59, lon: -122.60, info: '1090/978 MHz' },
  { id: 'GBT-TCM', name: 'JBLM GBT', type: 'gbt', lat: 47.14, lon: -122.48, info: '1090/978 MHz' },
  { id: 'GBT-YKM', name: 'Yakima GBT', type: 'gbt', lat: 46.57, lon: -120.54, info: '1090/978 MHz' },
]
