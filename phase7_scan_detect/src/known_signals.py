"""Known signal catalog for matching detections to identified transmitters."""

from dataclasses import dataclass


@dataclass
class KnownSignal:
    name: str
    freq_mhz: float
    bandwidth_khz: float
    modulation: str | None
    description: str


# Signal catalog — common signals an RTL-SDR can receive
SIGNAL_CATALOG: list[KnownSignal] = [
    # FM Broadcast
    KnownSignal("FM Broadcast", 98.0, 200, "WBFM", "Commercial FM radio"),

    # Aviation
    KnownSignal("Aviation Voice", 121.5, 25, "AM-DSB", "International aviation emergency"),
    KnownSignal("Aviation ATIS", 127.0, 25, "AM-DSB", "Automatic terminal info service"),

    # Weather
    KnownSignal("NOAA Weather", 162.4, 25, "WBFM", "NOAA weather radio"),
    KnownSignal("NOAA Weather", 162.425, 25, "WBFM", "NOAA weather radio"),
    KnownSignal("NOAA Weather", 162.45, 25, "WBFM", "NOAA weather radio"),
    KnownSignal("NOAA Weather", 162.475, 25, "WBFM", "NOAA weather radio"),
    KnownSignal("NOAA Weather", 162.5, 25, "WBFM", "NOAA weather radio"),
    KnownSignal("NOAA Weather", 162.525, 25, "WBFM", "NOAA weather radio"),
    KnownSignal("NOAA Weather", 162.55, 25, "WBFM", "NOAA weather radio"),

    # Amateur Radio
    KnownSignal("2m FM Calling", 146.52, 25, "WBFM", "2m national calling frequency"),
    KnownSignal("70cm FM Calling", 446.0, 25, "WBFM", "70cm national calling frequency"),
    KnownSignal("2m APRS", 144.39, 25, None, "APRS packet radio"),

    # Maritime
    KnownSignal("Marine VHF Ch16", 156.8, 25, "WBFM", "International maritime distress/calling"),

    # Satellite
    KnownSignal("NOAA APT", 137.1, 40, "AM-DSB", "NOAA-15 APT weather satellite"),
    KnownSignal("NOAA APT", 137.9125, 40, "AM-DSB", "NOAA-18 APT weather satellite"),
    KnownSignal("NOAA APT", 137.62, 40, "AM-DSB", "NOAA-19 APT weather satellite"),
    KnownSignal("Meteor-M2 LRPT", 137.1, 150, "QPSK", "Meteor-M2 LRPT satellite imagery"),
    KnownSignal("GOES LRIT", 1694.1, 600, "BPSK", "GOES-16/18 LRIT downlink"),
    KnownSignal("GOES HRIT", 1694.1, 2600, "BPSK", "GOES-16/18 HRIT downlink"),

    # ADS-B
    KnownSignal("ADS-B", 1090.0, 2000, None, "Aircraft transponder (Mode S)"),

    # ISM Band
    KnownSignal("ISM 433", 433.92, 500, None, "ISM band (remotes, sensors)"),
    KnownSignal("ISM 915", 915.0, 500, None, "ISM band (LoRa, Zigbee)"),

    # Pager
    KnownSignal("POCSAG Pager", 152.48, 25, None, "POCSAG paging system"),

    # Trunking
    KnownSignal("P25 Control", 851.0, 12.5, "CPFSK", "P25 trunked radio control channel"),
]


def match_signal(freq_hz: float, modulation: str | None = None, tolerance_khz: float = 50.0) -> KnownSignal | None:
    """Find the best matching known signal for a detection.

    Args:
        freq_hz: detected frequency in Hz
        modulation: classified modulation type (optional)
        tolerance_khz: frequency match tolerance in kHz

    Returns:
        Best matching KnownSignal or None
    """
    freq_mhz = freq_hz / 1e6
    best_match = None
    best_distance = float("inf")

    for sig in SIGNAL_CATALOG:
        distance_khz = abs(freq_mhz - sig.freq_mhz) * 1000
        if distance_khz > tolerance_khz:
            continue

        # Prefer matches where modulation also matches
        score = distance_khz
        if modulation and sig.modulation and modulation == sig.modulation:
            score *= 0.5  # boost matching modulation

        if score < best_distance:
            best_distance = score
            best_match = sig

    return best_match
