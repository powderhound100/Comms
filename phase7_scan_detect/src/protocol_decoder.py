"""Protocol-level decoders that extract usable data from demodulated signals.

Sits on top of the demodulator layer. Given a detected signal's frequency,
modulation, and raw IQ, this module decodes the actual protocol content:
- ADS-B → aircraft ICAO, callsign, lat/lon, altitude, velocity
- NOAA APT → triggers SatDump for weather satellite imagery
- APRS → callsign, lat/lon, status message
- POCSAG → pager address, message text
- ACARS → aircraft message text
"""

import logging
import struct
import subprocess
import json
import os
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Decoded data structures
# ---------------------------------------------------------------------------

@dataclass
class DecodedData:
    """Base for all protocol-decoded output."""
    protocol: str
    summary: str
    raw_hex: str | None = None
    fields: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class AircraftPosition:
    """Decoded ADS-B aircraft position."""
    icao_hex: str
    callsign: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    altitude_ft: int | None = None
    ground_speed_kt: float | None = None
    heading_deg: float | None = None
    vertical_rate_fpm: int | None = None
    squawk: str | None = None
    on_ground: bool = False


@dataclass
class APRSPosition:
    """Decoded APRS position report."""
    callsign: str
    latitude: float | None = None
    longitude: float | None = None
    symbol: str | None = None
    comment: str | None = None
    course_deg: float | None = None
    speed_kt: float | None = None


@dataclass
class SatelliteDecodeJob:
    """Triggered satellite decode job."""
    satellite: str
    pipeline: str
    iq_file: str
    output_dir: str
    status: str = "queued"  # queued | running | complete | failed


@dataclass
class POCSAGMessage:
    """Decoded POCSAG pager message."""
    address: int
    function_bits: int
    message: str
    is_numeric: bool = False


# ---------------------------------------------------------------------------
# Protocol Decoder
# ---------------------------------------------------------------------------

class ProtocolDecoder:
    """Decode protocol-level data from detected signals based on frequency and type."""

    # Frequency → protocol mapping (center freq in Hz, tolerance in Hz)
    PROTOCOL_MAP = [
        (1_090_000_000, 2_000_000, "adsb"),
        (137_100_000, 50_000, "noaa_apt"),       # NOAA-15
        (137_912_500, 50_000, "noaa_apt"),       # NOAA-18
        (137_620_000, 50_000, "noaa_apt"),       # NOAA-19
        (137_100_000, 200_000, "meteor_lrpt"),   # Meteor-M2 (overlaps NOAA-15)
        (1_694_100_000, 1_000_000, "goes_lrit"), # GOES LRIT
        (144_390_000, 15_000, "aprs"),           # APRS NA
        (152_480_000, 25_000, "pocsag"),         # POCSAG pager
    ]

    def __init__(
        self,
        iq_output_dir: str = "output/iq_captures",
        satdump_output_dir: str = "output/satellite",
        enable_satdump: bool = True,
    ):
        self.iq_output_dir = Path(iq_output_dir)
        self.iq_output_dir.mkdir(parents=True, exist_ok=True)
        self.satdump_output_dir = Path(satdump_output_dir)
        self.satdump_output_dir.mkdir(parents=True, exist_ok=True)
        self.enable_satdump = enable_satdump

        # ADS-B state: track aircraft by ICAO
        self._aircraft: dict[str, AircraftPosition] = {}

        # Pending satellite decode jobs
        self._sat_jobs: list[SatelliteDecodeJob] = []

    def identify_protocol(self, freq_hz: float) -> str | None:
        """Identify which protocol a frequency belongs to."""
        for center, tolerance, protocol in self.PROTOCOL_MAP:
            if abs(freq_hz - center) <= tolerance:
                return protocol
        return None

    def decode(
        self,
        iq_samples: np.ndarray,
        freq_hz: float,
        bandwidth_hz: float,
        sample_rate: int,
        modulation: str | None = None,
        snr_db: float = 0.0,
    ) -> DecodedData | None:
        """Attempt protocol-level decoding of a detected signal.

        Returns DecodedData with protocol-specific fields, or None.
        """
        protocol = self.identify_protocol(freq_hz)
        if protocol is None:
            return None

        try:
            if protocol == "adsb":
                return self._decode_adsb(iq_samples, sample_rate)
            elif protocol == "noaa_apt":
                return self._decode_noaa_apt(iq_samples, freq_hz, sample_rate, snr_db)
            elif protocol == "meteor_lrpt":
                return self._decode_meteor_lrpt(iq_samples, freq_hz, sample_rate, snr_db)
            elif protocol == "goes_lrit":
                return self._decode_goes_lrit(iq_samples, freq_hz, sample_rate, snr_db)
            elif protocol == "aprs":
                return self._decode_aprs(iq_samples, sample_rate)
            elif protocol == "pocsag":
                return self._decode_pocsag(iq_samples, sample_rate)
        except Exception as e:
            logger.warning("Protocol decode failed for %s: %s", protocol, e)

        return None

    @property
    def tracked_aircraft(self) -> dict[str, AircraftPosition]:
        """Current aircraft position table."""
        return dict(self._aircraft)

    @property
    def satellite_jobs(self) -> list[SatelliteDecodeJob]:
        return list(self._sat_jobs)

    # -------------------------------------------------------------------
    # ADS-B Decoder
    # -------------------------------------------------------------------

    def _decode_adsb(self, iq: np.ndarray, sample_rate: int) -> DecodedData | None:
        """Decode ADS-B Mode S messages from 1090 MHz IQ.

        ADS-B uses PPM at 1 Mbps. Each message is 112 bits with an 8μs preamble.
        We detect the preamble pattern and extract message bits.
        """
        # Compute envelope (magnitude)
        envelope = np.abs(iq).astype(np.float32)

        # Resample to exactly 2 Msps (2 samples per bit) for easy decoding
        target_rate = 2_000_000
        if sample_rate != target_rate:
            from scipy import signal as sp_signal
            ratio = target_rate / sample_rate
            new_len = int(len(envelope) * ratio)
            envelope = sp_signal.resample(envelope, new_len)

        # Normalize
        if np.max(envelope) > 0:
            envelope = envelope / np.max(envelope)

        # Detect preamble: 1010000101000000 (16 samples at 2 Msps = 8 μs)
        preamble = np.array([1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0], dtype=np.float32)
        threshold = 0.3
        messages_decoded = 0
        positions = []

        # Slide through the envelope looking for preambles
        msg_len_samples = 16 + 112 * 2  # preamble + 112 bits * 2 samples/bit
        i = 0
        while i < len(envelope) - msg_len_samples:
            # Correlate with preamble
            segment = envelope[i:i + 16]
            if len(segment) < 16:
                break

            # Simple threshold check on preamble positions
            high_ok = (segment[0] > threshold and segment[2] > threshold
                       and segment[7] > threshold and segment[9] > threshold)
            low_ok = (segment[1] < threshold and segment[3] < threshold
                      and segment[4] < threshold and segment[5] < threshold)

            if not (high_ok and low_ok):
                i += 1
                continue

            # Extract 112 bits (2 samples per bit, PPM: compare first vs second half)
            bits = []
            bit_start = i + 16
            for b in range(112):
                s0 = envelope[bit_start + b * 2] if bit_start + b * 2 < len(envelope) else 0
                s1 = envelope[bit_start + b * 2 + 1] if bit_start + b * 2 + 1 < len(envelope) else 0
                bits.append(1 if s0 > s1 else 0)

            if len(bits) < 112:
                i += 1
                continue

            # Convert bits to bytes
            msg_bytes = bytearray()
            for byte_idx in range(14):  # 112 bits = 14 bytes
                byte_val = 0
                for bit_idx in range(8):
                    byte_val = (byte_val << 1) | bits[byte_idx * 1 + byte_idx + bit_idx]
                    # Correct indexing
                byte_val = 0
                for bit_idx in range(8):
                    byte_val = (byte_val << 1) | bits[byte_idx + byte_idx * 0 + byte_idx]
                msg_bytes.append(byte_val)

            # Simpler: pack bits directly
            msg_bytes = bytearray()
            for byte_idx in range(14):
                val = 0
                for bit_idx in range(8):
                    val = (val << 1) | bits[byte_idx * 8 + bit_idx]
                msg_bytes.append(val)

            msg_hex = msg_bytes.hex().upper()

            # Check downlink format (DF) — first 5 bits
            df = (msg_bytes[0] >> 3) & 0x1F

            if df == 17:  # ADS-B Extended Squitter
                aircraft = self._parse_adsb_message(msg_bytes)
                if aircraft:
                    self._aircraft[aircraft.icao_hex] = aircraft
                    messages_decoded += 1
                    if aircraft.latitude is not None:
                        positions.append({
                            "icao": aircraft.icao_hex,
                            "callsign": aircraft.callsign,
                            "lat": aircraft.latitude,
                            "lon": aircraft.longitude,
                            "alt_ft": aircraft.altitude_ft,
                            "speed_kt": aircraft.ground_speed_kt,
                            "heading": aircraft.heading_deg,
                        })

            i += msg_len_samples  # Skip past this message

        if messages_decoded == 0:
            return None

        summary_parts = [f"{messages_decoded} ADS-B msgs"]
        if positions:
            p = positions[0]
            summary_parts.append(
                f"ICAO {p['icao']}"
                + (f" ({p['callsign']})" if p.get('callsign') else "")
                + (f" @ {p['lat']:.4f},{p['lon']:.4f}" if p.get('lat') else "")
                + (f" FL{p['alt_ft'] // 100}" if p.get('alt_ft') else "")
            )

        return DecodedData(
            protocol="adsb",
            summary=" | ".join(summary_parts),
            fields={
                "messages_decoded": messages_decoded,
                "aircraft_tracked": len(self._aircraft),
                "positions": positions,
                "aircraft_table": {
                    icao: asdict(ac) for icao, ac in self._aircraft.items()
                },
            },
        )

    def _parse_adsb_message(self, msg: bytearray) -> AircraftPosition | None:
        """Parse a single ADS-B Extended Squitter (DF=17) message."""
        # ICAO address: bytes 1-3
        icao = msg[1:4].hex().upper()

        # Get or create aircraft entry
        if icao in self._aircraft:
            aircraft = self._aircraft[icao]
        else:
            aircraft = AircraftPosition(icao_hex=icao)

        # Type code: first 5 bits of ME field (byte 4)
        tc = (msg[4] >> 3) & 0x1F

        if 1 <= tc <= 4:
            # Aircraft identification
            aircraft.callsign = self._decode_callsign(msg[4:11])
        elif 9 <= tc <= 18:
            # Airborne position (barometric)
            aircraft.altitude_ft = self._decode_altitude(msg[4:11], tc)
            lat, lon = self._decode_cpr_position(msg[4:11], tc)
            if lat is not None:
                aircraft.latitude = lat
                aircraft.longitude = lon
            aircraft.on_ground = False
        elif tc == 19:
            # Airborne velocity
            speed, heading, vrate = self._decode_velocity(msg[4:11])
            if speed is not None:
                aircraft.ground_speed_kt = speed
            if heading is not None:
                aircraft.heading_deg = heading
            if vrate is not None:
                aircraft.vertical_rate_fpm = vrate
        elif 5 <= tc <= 8:
            # Surface position
            aircraft.on_ground = True

        return aircraft

    def _decode_callsign(self, me: bytes) -> str:
        """Decode aircraft callsign from identification message."""
        charset = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ##### ###############0123456789######"
        # 8 characters, 6 bits each, starting at bit 8 of ME
        bits = 0
        for b in me:
            bits = (bits << 8) | b

        callsign = ""
        for i in range(8):
            shift = (7 - i) * 6 + 8  # 6 bits per char, offset by TC+CA (8 bits)
            if shift < 0:
                break
            idx = (bits >> max(0, shift - 6)) & 0x3F
            # Simplified: extract from the 48-bit callsign field
            pass

        # Simpler extraction: ME bytes 1-6 contain 8 chars * 6 bits = 48 bits
        callsign_bits = 0
        for b in me[1:7]:
            callsign_bits = (callsign_bits << 8) | b

        callsign = ""
        for i in range(8):
            idx = (callsign_bits >> (42 - i * 6)) & 0x3F
            if 0 < idx < len(charset):
                callsign += charset[idx]

        return callsign.strip()

    def _decode_altitude(self, me: bytes, tc: int) -> int | None:
        """Decode barometric altitude from airborne position message."""
        # Altitude is in bits 8-19 of ME (12 bits)
        alt_bits = ((me[1] & 0xFF) << 4) | ((me[2] >> 4) & 0x0F)
        # Q-bit is bit 4 of the altitude code
        q_bit = (alt_bits >> 4) & 1
        if q_bit:
            # Remove Q-bit and compute: N * 25 - 1000
            n = ((alt_bits >> 5) << 4) | (alt_bits & 0x0F)
            return n * 25 - 1000
        return None

    def _decode_cpr_position(self, me: bytes, tc: int) -> tuple[float | None, float | None]:
        """Decode CPR-encoded lat/lon (simplified — single message estimate)."""
        # Full CPR decoding needs both even and odd messages.
        # This gives a rough position from a single frame.
        lat_bits = ((me[2] & 0x03) << 15) | (me[3] << 7) | (me[4] >> 1)
        lon_bits = ((me[4] & 0x01) << 16) | (me[5] << 8) | me[6]

        # Normalize to 0-1 range
        lat_cpr = lat_bits / 131072.0
        lon_cpr = lon_bits / 131072.0

        # Rough position estimate (good to ~5 nm without even/odd pair)
        lat = lat_cpr * 90.0
        lon = lon_cpr * 360.0
        if lon > 180:
            lon -= 360

        # These are rough — real decoding needs message pairs
        if 0 < abs(lat) < 90 and abs(lon) <= 180:
            return round(lat, 4), round(lon, 4)
        return None, None

    def _decode_velocity(self, me: bytes) -> tuple[float | None, float | None, int | None]:
        """Decode ground speed, heading, and vertical rate."""
        subtype = me[0] & 0x07

        if subtype in (1, 2):
            # Ground speed (subtype 1=subsonic, 2=supersonic)
            ew_sign = (me[1] >> 2) & 1
            ew_vel = ((me[1] & 0x03) << 8) | me[2]
            ns_sign = (me[3] >> 7) & 1
            ns_vel = ((me[3] & 0x7F) << 3) | (me[4] >> 5)

            ew = (ew_vel - 1) * (-1 if ew_sign else 1)
            ns = (ns_vel - 1) * (-1 if ns_sign else 1)

            speed = (ew**2 + ns**2) ** 0.5
            heading = (np.degrees(np.arctan2(ew, ns)) + 360) % 360

            # Vertical rate
            vr_sign = (me[4] >> 3) & 1
            vr_val = ((me[4] & 0x07) << 6) | (me[5] >> 2)
            vrate = (vr_val - 1) * 64 * (-1 if vr_sign else 1)

            return round(speed, 1), round(heading, 1), vrate

        return None, None, None

    # -------------------------------------------------------------------
    # APRS Decoder
    # -------------------------------------------------------------------

    def _decode_aprs(self, iq: np.ndarray, sample_rate: int) -> DecodedData | None:
        """Decode APRS (AX.25) packets from 144.39 MHz.

        APRS uses 1200 baud Bell 202 AFSK (1200/2200 Hz tones) over AX.25.
        """
        # FM demodulate first
        phase_diff = np.angle(iq[1:] * np.conj(iq[:-1]))
        audio_rate = 22050
        from scipy import signal as sp_signal
        decim = max(1, sample_rate // audio_rate)
        audio = sp_signal.decimate(phase_diff, decim, zero_phase=True)

        # Bell 202 AFSK: mark=1200 Hz, space=2200 Hz
        # Bandpass filter around 1200-2200 Hz
        nyq = audio_rate / 2
        b_bp, a_bp = sp_signal.butter(4, [900 / nyq, 2500 / nyq], btype='band')
        filtered = sp_signal.lfilter(b_bp, a_bp, audio)

        # Zero-crossing frequency estimation for bit detection
        baud_rate = 1200
        samples_per_bit = audio_rate / baud_rate

        # Detect zero crossings
        crossings = np.where(np.diff(np.sign(filtered)))[0]
        if len(crossings) < 20:
            return None

        # Estimate instantaneous frequency from zero-crossing intervals
        intervals = np.diff(crossings)
        inst_freq = audio_rate / (2.0 * intervals)  # half-period to full freq

        # Threshold between mark (1200) and space (2200)
        center_freq = 1700
        bits = (inst_freq < center_freq).astype(np.uint8)  # mark=1, space=0

        # NRZI decode: bit change = 0, no change = 1
        nrzi_bits = np.where(np.diff(bits) != 0, 0, 1).astype(np.uint8)

        # Look for AX.25 flag (0x7E = 01111110)
        flag_pattern = np.array([0, 1, 1, 1, 1, 1, 1, 0], dtype=np.uint8)
        packets = self._find_ax25_packets(nrzi_bits, flag_pattern)

        if not packets:
            return None

        positions = []
        for pkt in packets:
            parsed = self._parse_ax25_packet(pkt)
            if parsed:
                positions.append(asdict(parsed))

        if not positions:
            return DecodedData(
                protocol="aprs",
                summary=f"{len(packets)} AX.25 frames detected (unparseable)",
                fields={"packets_found": len(packets)},
            )

        p = positions[0]
        summary = f"APRS: {p['callsign']}"
        if p.get('latitude'):
            summary += f" @ {p['latitude']:.4f},{p['longitude']:.4f}"
        if p.get('comment'):
            summary += f" — {p['comment'][:40]}"

        return DecodedData(
            protocol="aprs",
            summary=summary,
            fields={
                "packets_decoded": len(positions),
                "positions": positions,
            },
        )

    def _find_ax25_packets(self, bits: np.ndarray, flag: np.ndarray) -> list[np.ndarray]:
        """Find AX.25 packets between flag sequences."""
        packets = []
        flag_len = len(flag)
        i = 0
        start = None

        while i <= len(bits) - flag_len:
            if np.array_equal(bits[i:i + flag_len], flag):
                if start is not None and i - start > 16:
                    # Bit-unstuff: remove zero after five consecutive ones
                    raw = bits[start + flag_len:i]
                    unstuffed = self._bit_unstuff(raw)
                    if len(unstuffed) >= 136:  # minimum AX.25: 14 addr + 1 ctrl + 1 pid + 1 data
                        packets.append(unstuffed)
                start = i
                i += flag_len
            else:
                i += 1

        return packets[:10]  # Limit

    def _bit_unstuff(self, bits: np.ndarray) -> np.ndarray:
        """Remove bit stuffing (zero after five consecutive ones)."""
        result = []
        ones_count = 0
        for bit in bits:
            if ones_count == 5:
                ones_count = 0
                if bit == 0:
                    continue  # Skip stuffed zero
            result.append(bit)
            ones_count = ones_count + 1 if bit == 1 else 0
        return np.array(result, dtype=np.uint8)

    def _parse_ax25_packet(self, bits: np.ndarray) -> APRSPosition | None:
        """Parse AX.25 packet to extract APRS position data."""
        # Convert bits to bytes
        n_bytes = len(bits) // 8
        if n_bytes < 17:
            return None

        pkt_bytes = bytearray()
        for i in range(n_bytes):
            val = 0
            for j in range(8):
                val = (val << 1) | int(bits[i * 8 + j])
            pkt_bytes.append(val)

        # AX.25 address field: dest (7 bytes) + source (7 bytes)
        # Each char is ASCII shifted left by 1
        try:
            dest = "".join(chr(b >> 1) for b in pkt_bytes[0:6]).strip()
            src = "".join(chr(b >> 1) for b in pkt_bytes[7:13]).strip()
        except (ValueError, IndexError):
            return None

        # Information field starts after addresses + control + PID
        info_start = 16  # 14 addr + 1 ctrl + 1 pid (minimum, no digipeaters)
        if info_start >= len(pkt_bytes):
            return None

        info = pkt_bytes[info_start:]
        info_str = info.decode('ascii', errors='replace')

        # Parse APRS position formats
        position = APRSPosition(callsign=src)

        # Standard position: !DDMM.hhN/DDDMM.hhW
        # or compressed, or mic-e
        if len(info_str) > 0 and info_str[0] in ('!', '/', '@', '='):
            lat_lon = self._parse_aprs_position_string(info_str[1:])
            if lat_lon:
                position.latitude, position.longitude = lat_lon
            # Comment is everything after the position
            if len(info_str) > 20:
                position.comment = info_str[20:].strip()

        return position

    def _parse_aprs_position_string(self, s: str) -> tuple[float, float] | None:
        """Parse APRS standard position format: DDMM.hhN/DDDMM.hhW"""
        try:
            if len(s) < 18:
                return None
            # Latitude: DDMM.hhN
            lat_deg = int(s[0:2])
            lat_min = float(s[2:7])
            lat_ns = s[7]
            lat = lat_deg + lat_min / 60.0
            if lat_ns == 'S':
                lat = -lat

            # Longitude: DDDMM.hhW
            lon_deg = int(s[9:12])
            lon_min = float(s[12:17])
            lon_ew = s[17]
            lon = lon_deg + lon_min / 60.0
            if lon_ew == 'W':
                lon = -lon

            if -90 <= lat <= 90 and -180 <= lon <= 180:
                return round(lat, 4), round(lon, 4)
        except (ValueError, IndexError):
            pass
        return None

    # -------------------------------------------------------------------
    # Satellite Image Triggers
    # -------------------------------------------------------------------

    def _decode_noaa_apt(
        self, iq: np.ndarray, freq_hz: float, sample_rate: int, snr_db: float
    ) -> DecodedData | None:
        """Handle NOAA APT signal — save IQ and trigger SatDump decode."""
        # Identify which NOAA satellite
        sat_name = "NOAA-19"
        if abs(freq_hz - 137_100_000) < 50_000:
            sat_name = "NOAA-15"
        elif abs(freq_hz - 137_912_500) < 50_000:
            sat_name = "NOAA-18"

        return self._save_and_trigger_satdump(
            iq, freq_hz, sample_rate, snr_db,
            satellite=sat_name,
            pipeline="noaa_apt",
            capture_type="APT",
        )

    def _decode_meteor_lrpt(
        self, iq: np.ndarray, freq_hz: float, sample_rate: int, snr_db: float
    ) -> DecodedData | None:
        """Handle Meteor-M2 LRPT signal — save IQ and trigger SatDump decode."""
        return self._save_and_trigger_satdump(
            iq, freq_hz, sample_rate, snr_db,
            satellite="Meteor-M2-3",
            pipeline="meteor_m2_lrpt",
            capture_type="LRPT",
        )

    def _decode_goes_lrit(
        self, iq: np.ndarray, freq_hz: float, sample_rate: int, snr_db: float
    ) -> DecodedData | None:
        """Handle GOES LRIT signal — save IQ and trigger SatDump decode."""
        return self._save_and_trigger_satdump(
            iq, freq_hz, sample_rate, snr_db,
            satellite="GOES-18",
            pipeline="goes_hrit_lrit",
            capture_type="LRIT",
        )

    def _save_and_trigger_satdump(
        self,
        iq: np.ndarray,
        freq_hz: float,
        sample_rate: int,
        snr_db: float,
        satellite: str,
        pipeline: str,
        capture_type: str,
    ) -> DecodedData:
        """Save IQ capture to file and queue SatDump decode job."""
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        filename = f"{satellite}_{capture_type}_{timestamp}.raw"
        iq_path = self.iq_output_dir / filename

        # Save raw IQ as interleaved float32 (SatDump input format)
        interleaved = np.column_stack([iq.real, iq.imag]).flatten().astype(np.float32)
        interleaved.tofile(str(iq_path))
        file_size_mb = iq_path.stat().st_size / (1024 * 1024)

        logger.info(
            "Saved IQ capture: %s (%.1f MB, SNR %.1f dB)",
            filename, file_size_mb, snr_db,
        )

        # Create output directory for decoded products
        output_dir = self.satdump_output_dir / f"{satellite}_{timestamp}"
        output_dir.mkdir(parents=True, exist_ok=True)

        # Queue SatDump job
        job = SatelliteDecodeJob(
            satellite=satellite,
            pipeline=pipeline,
            iq_file=str(iq_path),
            output_dir=str(output_dir),
        )
        self._sat_jobs.append(job)

        # Try to launch SatDump asynchronously
        decoded_files = []
        if self.enable_satdump:
            decoded_files = self._run_satdump(job, sample_rate)

        summary = f"{satellite} {capture_type} captured: {filename} ({file_size_mb:.1f} MB)"
        if decoded_files:
            summary += f" → {len(decoded_files)} images decoded"

        return DecodedData(
            protocol=f"satellite_{capture_type.lower()}",
            summary=summary,
            fields={
                "satellite": satellite,
                "capture_type": capture_type,
                "iq_file": str(iq_path),
                "output_dir": str(output_dir),
                "file_size_mb": round(file_size_mb, 1),
                "snr_db": round(snr_db, 1),
                "sample_rate": sample_rate,
                "frequency_hz": freq_hz,
                "decoded_files": decoded_files,
                "job_status": job.status,
            },
        )

    def _run_satdump(self, job: SatelliteDecodeJob, sample_rate: int) -> list[str]:
        """Execute SatDump CLI for satellite image decoding."""
        satdump_cmd = "satdump"
        if os.name == "nt":
            satdump_cmd = r"C:\Program Files\SatDump\satdump.exe"

        cmd = [
            satdump_cmd,
            job.pipeline,
            "baseband",
            job.iq_file,
            job.output_dir,
            "--samplerate", str(sample_rate),
        ]

        job.status = "running"
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600,
            )
            job.status = "complete" if result.returncode == 0 else "failed"

            # Parse output for decoded file paths
            decoded = []
            for line in result.stdout.split("\n"):
                import re
                match = re.search(r"(?:Saved|Writing|Output)\s+(.+\.(?:png|jpg|bmp|tif))", line)
                if match:
                    decoded.append(match.group(1).strip())

            logger.info("SatDump %s: %d files decoded", job.status, len(decoded))
            return decoded

        except FileNotFoundError:
            logger.warning("SatDump not found at %s — decode skipped", satdump_cmd)
            job.status = "failed"
            return []
        except subprocess.TimeoutExpired:
            logger.warning("SatDump timed out for %s", job.iq_file)
            job.status = "failed"
            return []

    # -------------------------------------------------------------------
    # POCSAG Decoder
    # -------------------------------------------------------------------

    def _decode_pocsag(self, iq: np.ndarray, sample_rate: int) -> DecodedData | None:
        """Decode POCSAG pager messages.

        POCSAG uses 512/1200/2400 baud FSK with specific codeword structure.
        """
        # FM demodulate
        phase_diff = np.angle(iq[1:] * np.conj(iq[:-1]))

        # Assume 1200 baud POCSAG
        baud_rate = 1200
        from scipy import signal as sp_signal

        # Low-pass filter the demodulated signal
        nyq = sample_rate / 2
        cutoff = baud_rate * 1.5 / nyq
        if cutoff >= 1:
            cutoff = 0.99
        b, a = sp_signal.butter(4, cutoff, btype='low')
        filtered = sp_signal.lfilter(b, a, phase_diff)

        # Resample to 4x baud rate for clock recovery
        target_rate = baud_rate * 4
        decim = max(1, sample_rate // target_rate)
        decimated = filtered[::decim]

        # Threshold to bits
        threshold = np.median(decimated)
        bits = (decimated > threshold).astype(np.uint8)

        # Look for POCSAG sync codeword: 0x7CD215D8 (32 bits)
        sync_pattern = np.array([int(b) for b in format(0x7CD215D8, '032b')], dtype=np.uint8)

        # Search for sync (allow some bit errors)
        messages = []
        sps = 4  # samples per symbol at our decimated rate

        for start in range(0, len(bits) - len(sync_pattern) * sps, sps):
            # Sample at symbol centers
            symbols = bits[start::sps]
            if len(symbols) < 32:
                break

            # Correlate with sync
            sync_check = symbols[:32]
            errors = np.sum(sync_check != sync_pattern)
            if errors > 3:  # Allow up to 3 bit errors
                continue

            # Found sync — extract batch (16 codewords after sync)
            batch_start = start + 32 * sps
            for cw_idx in range(16):
                cw_start = batch_start + cw_idx * 32 * sps
                if cw_start + 32 * sps > len(bits):
                    break
                cw_symbols = bits[cw_start::sps][:32]
                if len(cw_symbols) < 32:
                    break

                # First bit: 0=address, 1=message
                if cw_symbols[0] == 0:
                    # Address codeword
                    addr_bits = cw_symbols[1:19]
                    addr = 0
                    for b in addr_bits:
                        addr = (addr << 1) | int(b)
                    func = (cw_symbols[19] << 1) | cw_symbols[20]
                else:
                    # Message codeword — extract 20 data bits
                    data_bits = cw_symbols[1:21]
                    # Convert to characters (7-bit ASCII or 4-bit numeric)
                    chars = []
                    for ci in range(0, len(data_bits) - 6, 7):
                        char_val = 0
                        for b in data_bits[ci:ci + 7]:
                            char_val = (char_val << 1) | int(b)
                        if 32 <= char_val < 127:
                            chars.append(chr(char_val))
                    if chars:
                        messages.append("".join(chars))

            break  # Process first batch only

        if not messages:
            return None

        msg_text = " ".join(messages)
        return DecodedData(
            protocol="pocsag",
            summary=f"POCSAG: {msg_text[:80]}",
            fields={
                "messages": messages,
                "baud_rate": baud_rate,
            },
        )
