/*
 * groundlink_uat.c — Fast C UAT (978 MHz) ADS-B decoder for GROUNDLINK.
 *
 * Reads raw IQ from RTL-SDR at 978 MHz / 2.083334 Msps, performs FM
 * discrimination to recover CPFSK-modulated bits, detects 36-bit sync
 * words, extracts and CRC-validates UAT messages, decodes aircraft
 * position/velocity/identity, and outputs binary frames on stdout for
 * the Python WebSocket server to forward to the browser.
 *
 * Build:  cl /O2 groundlink_uat.c /link rtlsdr.lib /out:groundlink_uat.exe
 *         gcc -O2 -o groundlink_uat groundlink_uat.c -lrtlsdr -lm
 * Usage:  groundlink_uat [--gain 496] [--device 0] [--device-serial SN] [--test]
 *
 * Output protocol (stdout, binary):
 *   Decoded frame:  'D' (1B) + length (uint32 LE) + UTF-8 JSON
 *   Spectrum frame: 'S' (1B) + length (uint32 LE) + center_freq (uint32 LE) + float[] dBFS
 *   Raw msg frame:  'M' (1B) + length (uint32 LE) + hex string
 */

#ifdef _MSC_VER
#define _CRT_SECURE_NO_WARNINGS
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdint.h>
#include <signal.h>
#include <time.h>

#ifdef _WIN32
#include <windows.h>
#include <fcntl.h>
#include <io.h>
#else
#include <unistd.h>
#endif

#include "rtlsdr.h"

/* ── Constants ─────────────────────────────────────────────────── */

#define UAT_FREQ            978000000       /* 978 MHz */
#define UAT_SAMPLE_RATE     2083334         /* 2.083334 Msps = 2 samples/bit at 1.041667 Mbps */
#define CAPTURE_BYTES       524288          /* 262144 IQ pairs (~126 ms at 2.083M) */
#define CAPTURE_IQ          (CAPTURE_BYTES / 2)

#define SYNC_BITS           36              /* 36-bit sync words */
#define SHORT_MSG_BITS      144             /* 18 data bytes */
#define LONG_MSG_BITS       272             /* 34 data bytes */
#define SHORT_MSG_BYTES     18
#define LONG_MSG_BYTES      34
#define SYNC_THRESHOLD      32              /* min matching bits out of 36 */

#define SAMPLES_PER_BIT     2               /* 2 IQ samples per UAT bit */

#define MAX_AIRCRAFT        256
#define AIRCRAFT_TIMEOUT_MS 60000           /* 60 seconds */

#define FFT_SIZE            1024
#define SPECTRUM_BINS       256             /* FFT_SIZE / 4 */
#define PI_F                3.14159265358979f

#define REPORT_INTERVAL     8               /* emit 'D' frame every N blocks (~1s) */
#define SPECTRUM_INTERVAL   10              /* emit 'S' frame every N blocks */

/* 36-bit sync words (MSB-first as uint64_t) */
#define SYNC_SHORT          0xEACDDA4E2ULL  /* Basic UAT short message */
#define SYNC_LONG           0x153225B1DULL  /* ADS-B UAT long message */

/* ── Globals ───────────────────────────────────────────────────── */

static volatile int g_running = 1;

static void sighandler(int sig) {
    (void)sig;
    g_running = 0;
}

/* ── Magnitude lookup table ──────────────────────────────────── */
/* 256x256 = 65536 entries, each uint16. Maps raw uint8 I,Q -> magnitude.
 * Eliminates per-sample float conversion + sqrt. ~128 KB, fits in L2. */

static uint16_t g_mag_lut[65536];

static void init_mag_lut(void) {
    for (int i = 0; i < 256; i++) {
        for (int q = 0; q < 256; q++) {
            float fi = (i - 127.5f) / 128.0f;
            float fq = (q - 127.5f) / 128.0f;
            float mag = sqrtf(fi * fi + fq * fq);
            uint32_t val = (uint32_t)(mag * 65535.0f / 1.414f);
            if (val > 65535) val = 65535;
            g_mag_lut[i * 256 + q] = (uint16_t)val;
        }
    }
}

/* ── CRC-24 lookup table ─────────────────────────────────────── */
/* Same polynomial as 1090 MHz ADS-B: 0x1FFF409 */

static uint32_t g_crc_table[256];

static void init_crc_table(void) {
    for (int i = 0; i < 256; i++) {
        uint32_t c = (uint32_t)i << 16;
        for (int j = 0; j < 8; j++) {
            if (c & 0x800000)
                c = (c << 1) ^ 0x1FFF409;
            else
                c <<= 1;
        }
        g_crc_table[i] = c & 0xFFFFFF;
    }
}

static uint32_t compute_crc(const uint8_t *msg, int n_bytes) {
    uint32_t rem = 0;
    for (int i = 0; i < n_bytes; i++) {
        rem = ((rem << 8) ^ g_crc_table[((rem >> 16) ^ msg[i]) & 0xFF]) & 0xFFFFFF;
    }
    return rem;
}

static int check_uat_crc(const uint8_t *msg, int msg_bytes) {
    /*
     * UAT CRC: last 3 bytes of the message are the CRC.
     * Compute CRC over data bytes, compare to stored CRC.
     */
    int data_bytes = msg_bytes - 3;
    if (data_bytes < 1) return 0;
    uint32_t computed = compute_crc(msg, data_bytes);
    uint32_t stored = ((uint32_t)msg[data_bytes] << 16) |
                      ((uint32_t)msg[data_bytes + 1] << 8) |
                       (uint32_t)msg[data_bytes + 2];
    return computed == stored;
}

/* ── FFT + Spectrum ──────────────────────────────────────────── */

static float g_hann[FFT_SIZE];

static void init_hann(void) {
    for (int i = 0; i < FFT_SIZE; i++) {
        g_hann[i] = 0.5f * (1.0f - cosf(2.0f * PI_F * i / (FFT_SIZE - 1)));
    }
}

static void fft_radix2(float *re, float *im, int n) {
    int i, j, k, m, step;
    float tr, ti, wr, wi, theta;

    j = 0;
    for (i = 0; i < n - 1; i++) {
        if (i < j) {
            tr = re[i]; re[i] = re[j]; re[j] = tr;
            ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
        k = n >> 1;
        while (k <= j) { j -= k; k >>= 1; }
        j += k;
    }

    for (step = 2; step <= n; step <<= 1) {
        m = step >> 1;
        theta = -PI_F / (float)m;
        for (k = 0; k < n; k += step) {
            for (j = 0; j < m; j++) {
                wr = cosf(theta * j);
                wi = sinf(theta * j);
                tr = wr * re[k + j + m] - wi * im[k + j + m];
                ti = wr * im[k + j + m] + wi * re[k + j + m];
                re[k + j + m] = re[k + j] - tr;
                im[k + j + m] = im[k + j] - ti;
                re[k + j] += tr;
                im[k + j] += ti;
            }
        }
    }
}

static void compute_spectrum(const uint8_t *raw_buf, int n_bytes,
                             uint32_t center_freq, float *out_bins) {
    float re[FFT_SIZE], im_buf[FFT_SIZE];
    int n_iq = n_bytes / 2;
    int offset = (n_iq - FFT_SIZE) / 2;
    if (offset < 0) offset = 0;

    (void)center_freq;

    for (int i = 0; i < FFT_SIZE; i++) {
        int idx = offset + i;
        re[i] = ((raw_buf[2 * idx] - 127.5f) / 128.0f) * g_hann[i];
        im_buf[i] = ((raw_buf[2 * idx + 1] - 127.5f) / 128.0f) * g_hann[i];
    }

    fft_radix2(re, im_buf, FFT_SIZE);

    float mag2[FFT_SIZE];
    float norm = 1.0f / ((float)FFT_SIZE * (float)FFT_SIZE);
    for (int i = 0; i < FFT_SIZE; i++) {
        mag2[i] = (re[i] * re[i] + im_buf[i] * im_buf[i]) * norm;
    }

    for (int i = 0; i < SPECTRUM_BINS; i++) {
        int src = ((i * 4) + FFT_SIZE / 2) % FFT_SIZE;
        float sum = 0.0f;
        for (int j = 0; j < 4; j++) {
            sum += mag2[(src + j) % FFT_SIZE];
        }
        sum /= 4.0f;
        out_bins[i] = 10.0f * log10f(sum + 1e-12f);
    }
}

/* ── Aircraft tracking table ──────────────────────────────────── */

typedef struct {
    uint32_t icao;
    char     callsign[9];
    double   latitude;
    double   longitude;
    int      altitude_ft;
    double   ground_speed_kt;
    double   heading_deg;
    int      vertical_rate_fpm;
    int      on_ground;
    int      has_position;
    int      messages;
    int      payload_type;      /* UAT payload type code */
    int64_t  last_seen;         /* ms since epoch */
    int      active;            /* slot in use */
} aircraft_t;

static aircraft_t g_aircraft[MAX_AIRCRAFT];
static int g_total_msgs = 0;
static int g_msgs_since_report = 0;

static int64_t now_ms(void) {
#ifdef _WIN32
    /* Use GetSystemTimeAsFileTime for reliable ms on Windows */
    FILETIME ft;
    GetSystemTimeAsFileTime(&ft);
    uint64_t t = ((uint64_t)ft.dwHighDateTime << 32) | ft.dwLowDateTime;
    /* Convert from 100-ns intervals since 1601 to ms since epoch */
    return (int64_t)((t - 116444736000000000ULL) / 10000ULL);
#else
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    return (int64_t)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
#endif
}

static aircraft_t *find_aircraft(uint32_t icao) {
    for (int i = 0; i < MAX_AIRCRAFT; i++) {
        if (g_aircraft[i].active && g_aircraft[i].icao == icao)
            return &g_aircraft[i];
    }
    return NULL;
}

static aircraft_t *get_or_create_aircraft(uint32_t icao) {
    aircraft_t *ac = find_aircraft(icao);
    if (ac) return ac;

    /* Find empty slot */
    for (int i = 0; i < MAX_AIRCRAFT; i++) {
        if (!g_aircraft[i].active) {
            memset(&g_aircraft[i], 0, sizeof(aircraft_t));
            g_aircraft[i].icao = icao;
            g_aircraft[i].active = 1;
            g_aircraft[i].last_seen = now_ms();
            return &g_aircraft[i];
        }
    }

    /* Table full -- evict oldest */
    int oldest_idx = 0;
    int64_t oldest_time = INT64_MAX;
    for (int i = 0; i < MAX_AIRCRAFT; i++) {
        if (g_aircraft[i].last_seen < oldest_time) {
            oldest_time = g_aircraft[i].last_seen;
            oldest_idx = i;
        }
    }
    memset(&g_aircraft[oldest_idx], 0, sizeof(aircraft_t));
    g_aircraft[oldest_idx].icao = icao;
    g_aircraft[oldest_idx].active = 1;
    g_aircraft[oldest_idx].last_seen = now_ms();
    return &g_aircraft[oldest_idx];
}

static void age_aircraft(int64_t now) {
    for (int i = 0; i < MAX_AIRCRAFT; i++) {
        if (g_aircraft[i].active && (now - g_aircraft[i].last_seen) > AIRCRAFT_TIMEOUT_MS) {
            g_aircraft[i].active = 0;
        }
    }
}

/* ── UAT callsign charset (same as 1090 ADS-B) ──────────────── */

static const char UAT_CHARSET[] =
    "#ABCDEFGHIJKLMNOPQRSTUVWXYZ##### ###############0123456789######";

/* ── FM discriminator ────────────────────────────────────────── */
/*
 * UAT uses CPFSK modulation. We recover bit values by computing the
 * instantaneous frequency via phase difference of consecutive IQ
 * samples: freq[n] = angle(sample[n] * conj(sample[n-1])).
 * Positive freq -> bit 1, negative freq -> bit 0.
 *
 * Output: array of float FM-demodulated values, one per IQ sample.
 * Caller then applies bit slicing at the sample-per-bit rate.
 */

static void fm_discriminate(const uint8_t *raw_iq, float *fm_out, int n_iq) {
    /* First sample has no predecessor — set to 0 */
    fm_out[0] = 0.0f;

    float prev_i = (raw_iq[0] - 127.5f);
    float prev_q = (raw_iq[1] - 127.5f);

    for (int s = 1; s < n_iq; s++) {
        float cur_i = (raw_iq[s * 2]     - 127.5f);
        float cur_q = (raw_iq[s * 2 + 1] - 127.5f);

        /*
         * Instantaneous frequency via conjugate multiply:
         *   prod = cur * conj(prev) = (ci*pi + cq*pq) + j*(cq*pi - ci*pq)
         *   freq = atan2(imag, real)
         */
        float re = cur_i * prev_i + cur_q * prev_q;
        float im = cur_q * prev_i - cur_i * prev_q;

        fm_out[s] = atan2f(im, re);

        prev_i = cur_i;
        prev_q = cur_q;
    }
}

/* ── Bit slicer ──────────────────────────────────────────────── */
/*
 * From FM-demodulated samples, extract bits at SAMPLES_PER_BIT rate.
 * For each bit period, average the samples and threshold at zero:
 *   positive average -> 1, negative average -> 0
 *
 * start_sample: index into fm_out where the bit stream begins
 * n_bits:       number of bits to extract
 * bits_out:     output bit array (0 or 1 per entry)
 *
 * Returns number of bits successfully extracted.
 */

static int slice_bits(const float *fm_out, int n_fm, int start_sample,
                      uint8_t *bits_out, int n_bits) {
    int extracted = 0;
    for (int b = 0; b < n_bits; b++) {
        int idx = start_sample + b * SAMPLES_PER_BIT;
        if (idx + SAMPLES_PER_BIT > n_fm) break;

        float sum = 0.0f;
        for (int s = 0; s < SAMPLES_PER_BIT; s++) {
            sum += fm_out[idx + s];
        }

        bits_out[b] = (sum >= 0.0f) ? 1 : 0;
        extracted++;
    }
    return extracted;
}

/* ── Sync word correlator ────────────────────────────────────── */
/*
 * Slide a window across the FM-demodulated bit stream and correlate
 * against the 36-bit sync words. Returns the number of matching bits.
 *
 * sync_word: 36-bit pattern stored in lower 36 bits of uint64_t
 * fm_out:    FM-demodulated sample array
 * n_fm:      number of FM samples
 * pos:       sample position to test (bit 0 of the sync word)
 */

static int correlate_sync(const float *fm_out, int n_fm, int pos,
                           uint64_t sync_word) {
    int matches = 0;
    for (int b = 0; b < SYNC_BITS; b++) {
        int idx = pos + b * SAMPLES_PER_BIT;
        if (idx + SAMPLES_PER_BIT > n_fm) return 0;

        /* Average samples for this bit period */
        float sum = 0.0f;
        for (int s = 0; s < SAMPLES_PER_BIT; s++) {
            sum += fm_out[idx + s];
        }

        int demod_bit = (sum >= 0.0f) ? 1 : 0;
        int sync_bit = (int)((sync_word >> (SYNC_BITS - 1 - b)) & 1);

        if (demod_bit == sync_bit)
            matches++;
    }
    return matches;
}

/* ── Bits to bytes ───────────────────────────────────────────── */

static void bits_to_bytes(const uint8_t *bits, uint8_t *bytes, int n_bits) {
    int n_bytes = n_bits / 8;
    memset(bytes, 0, n_bytes);
    for (int i = 0; i < n_bits; i++) {
        if (bits[i])
            bytes[i >> 3] |= (uint8_t)(1 << (7 - (i & 7)));
    }
}

/* ── UAT message parsing ─────────────────────────────────────── */
/*
 * Long UAT message (34 bytes total, 31 data + 3 CRC):
 *   Byte 0 bits [7:3]: Payload type
 *     1 = ADS-B with state vector (basic)
 *     2 = ADS-B with state vector + mode status (long UAT)
 *     3 = TIS-B coarse position
 *     4 = TIS-B fine position
 *     5-7 = reserved
 *   Bytes 1-3:   ICAO address (24 bits)
 *   Bytes 4-6:   Latitude (24-bit signed)
 *   Bytes 7-9:   Longitude (24-bit signed)
 *   Bytes 10-11: Altitude field
 *     bits [3:0] of byte 10 + bits [7:4] of byte 11 = 12-bit alt code
 *     altitude = code * 25 - 1000
 *   Byte 12 [7:0] + Byte 13 [7]: Ground speed (9-bit)
 *   Byte 13 [6:0] + Byte 14 [7]: Heading/track (8-bit)
 *     heading = val * (360.0 / 256.0)
 *   Byte 14 [6:0] + Byte 15 [7:4]: Vertical rate (11-bit signed)
 *     vr = (val - 1024) * 64 fpm  (offset binary)
 *   Bytes 17+: Callsign (for payload type 2), 8 chars * 6 bits
 *
 * Short UAT message (18 bytes total, 15 data + 3 CRC):
 *   Typically uplink / ground station info — limited aircraft data.
 *   We still log the ICAO if present.
 */

static void parse_uat_callsign(aircraft_t *ac, const uint8_t *msg,
                                int msg_len) {
    /*
     * Callsign in long UAT (payload type 2): bytes 17-23 contain
     * 8 characters encoded as 6-bit indices (48 bits = 6 bytes).
     * Same charset as 1090 ADS-B.
     */
    if (msg_len < 24) return;

    uint64_t chars = 0;
    for (int i = 17; i < 23; i++)
        chars = (chars << 8) | msg[i];

    for (int i = 0; i < 8; i++) {
        int idx = (int)((chars >> (42 - i * 6)) & 0x3F);
        if (idx >= 0 && idx < 64)
            ac->callsign[i] = UAT_CHARSET[idx];
        else
            ac->callsign[i] = ' ';
    }
    ac->callsign[8] = '\0';

    /* Trim trailing spaces and '#' */
    for (int i = 7; i >= 0; i--) {
        if (ac->callsign[i] == ' ' || ac->callsign[i] == '#')
            ac->callsign[i] = '\0';
        else
            break;
    }
}

static void parse_uat_long_message(const uint8_t *msg, int msg_len) {
    if (msg_len < LONG_MSG_BYTES) return;

    /* Payload type: byte 0, bits [7:3] */
    int payload_type = (msg[0] >> 3) & 0x1F;

    /* Only process ADS-B state vector messages (types 1-2) and TIS-B (3-4) */
    if (payload_type < 1 || payload_type > 7) return;

    /* ICAO address: bytes 1-3 */
    uint32_t icao = ((uint32_t)msg[1] << 16) |
                    ((uint32_t)msg[2] << 8) |
                     (uint32_t)msg[3];

    if (icao == 0 || icao == 0xFFFFFF) return;  /* invalid */

    aircraft_t *ac = get_or_create_aircraft(icao);
    ac->last_seen = now_ms();
    ac->messages++;
    ac->payload_type = payload_type;
    g_total_msgs++;
    g_msgs_since_report++;

    /* Latitude: bytes 4-6, 24-bit signed */
    int32_t lat_raw = ((int32_t)msg[4] << 16) |
                      ((int32_t)msg[5] << 8) |
                       (int32_t)msg[6];
    /* Sign-extend from 24-bit */
    if (lat_raw & 0x800000) lat_raw |= (int32_t)0xFF000000;

    /* Longitude: bytes 7-9, 24-bit signed */
    int32_t lon_raw = ((int32_t)msg[7] << 16) |
                      ((int32_t)msg[8] << 8) |
                       (int32_t)msg[9];
    if (lon_raw & 0x800000) lon_raw |= (int32_t)0xFF000000;

    double lat = lat_raw * (360.0 / 16777216.0);   /* 360 / 2^24 */
    double lon = lon_raw * (360.0 / 16777216.0);

    if (lat >= -90.0 && lat <= 90.0 && lon >= -180.0 && lon <= 180.0) {
        /* Check for non-zero position (all zeros = no position) */
        if (lat_raw != 0 || lon_raw != 0) {
            ac->latitude = lat;
            ac->longitude = lon;
            ac->has_position = 1;
        }
    }

    /* Altitude: byte 10 bits [3:0] concatenated with byte 11 bits [7:4]
     * = 12-bit altitude code */
    int alt_code = ((msg[10] & 0x0F) << 8) | (msg[11] & 0xFF);
    if (alt_code != 0) {
        ac->altitude_ft = alt_code * 25 - 1000;
    }

    /* Ground speed: byte 12 [7:0] + byte 13 bit [7] = 9-bit value */
    int gs_raw = ((int)msg[12] << 1) | ((msg[13] >> 7) & 0x01);
    if (gs_raw > 0) {
        ac->ground_speed_kt = (double)gs_raw;
    }

    /* Heading/track: byte 13 [6:0] + byte 14 [7] = 8-bit value */
    int hdg_raw = ((msg[13] & 0x7F) << 1) | ((msg[14] >> 7) & 0x01);
    ac->heading_deg = hdg_raw * (360.0 / 256.0);

    /* Vertical rate: byte 14 [6:0] + byte 15 [7:4] = 11-bit value, offset binary */
    int vr_raw = ((msg[14] & 0x7F) << 4) | ((msg[15] >> 4) & 0x0F);
    if (vr_raw != 0) {
        /* Offset binary: 1024 = 0 fpm, scale by 64 fpm/count */
        ac->vertical_rate_fpm = (vr_raw - 1024) * 64;
    }

    /* Airborne/ground status from altitude: if alt_code == 0, likely on ground */
    ac->on_ground = (alt_code == 0) ? 1 : 0;

    /* Callsign: available in payload type 2 (long UAT with mode status) */
    if (payload_type == 2) {
        parse_uat_callsign(ac, msg, msg_len);
    }
}

static void parse_uat_short_message(const uint8_t *msg, int msg_len) {
    /*
     * Short UAT messages (18 bytes: 15 data + 3 CRC) are typically
     * ground uplink (TIS-B, FIS-B) but may contain basic aircraft info.
     * Extract ICAO if present and log the contact.
     */
    if (msg_len < SHORT_MSG_BYTES) return;

    int payload_type = (msg[0] >> 3) & 0x1F;
    if (payload_type < 1 || payload_type > 7) return;

    uint32_t icao = ((uint32_t)msg[1] << 16) |
                    ((uint32_t)msg[2] << 8) |
                     (uint32_t)msg[3];

    if (icao == 0 || icao == 0xFFFFFF) return;

    aircraft_t *ac = get_or_create_aircraft(icao);
    ac->last_seen = now_ms();
    ac->messages++;
    ac->payload_type = payload_type;
    g_total_msgs++;
    g_msgs_since_report++;
}

/* ── Sync detection + message extraction ─────────────────────── */
/*
 * Slides through FM-demodulated IQ stream, correlates 36-bit sync
 * words at each sample position (stepped by 1 sample), extracts
 * bits after a matched sync, assembles bytes, and CRC-validates.
 */

/* Debug counters (reset each block) */
static int g_dbg_energy_skip = 0;
static int g_dbg_sync_checks = 0;
static int g_dbg_long_match = 0;
static int g_dbg_short_match = 0;
static int g_dbg_long_crc_ok = 0;
static int g_dbg_short_crc_ok = 0;
static int g_dbg_long_crc_fail = 0;
static int g_dbg_short_crc_fail = 0;
static int g_dbg_best_long_corr = 0;
static int g_dbg_best_short_corr = 0;

static int detect_and_decode_uat(const float *fm_out, int n_fm,
                                  const uint8_t *raw_iq) {
    int decoded = 0;
    int pos = 0;

    /* We need sync (36 bits * 2 samp/bit) + longest message (272 bits * 2 samp/bit)
     * = 72 + 544 = 616 samples beyond current position */
    int sync_samples = SYNC_BITS * SAMPLES_PER_BIT;
    int long_msg_samples = LONG_MSG_BITS * SAMPLES_PER_BIT;
    int short_msg_samples = SHORT_MSG_BITS * SAMPLES_PER_BIT;
    int min_remaining_long = sync_samples + long_msg_samples;
    int min_remaining_short = sync_samples + short_msg_samples;

    (void)raw_iq;

    g_dbg_energy_skip = 0;
    g_dbg_sync_checks = 0;
    g_dbg_long_match = 0;
    g_dbg_short_match = 0;
    g_dbg_long_crc_ok = 0;
    g_dbg_short_crc_ok = 0;
    g_dbg_long_crc_fail = 0;
    g_dbg_short_crc_fail = 0;
    g_dbg_best_long_corr = 0;
    g_dbg_best_short_corr = 0;

    while (pos < n_fm - min_remaining_short) {
        /* Quick pre-screen: check if the FM signal has sufficient energy
         * at this position by looking at the magnitude of the first few
         * demod samples. Skip silent regions. */
        float energy = 0.0f;
        for (int s = 0; s < 8 && (pos + s) < n_fm; s++) {
            energy += fabsf(fm_out[pos + s]);
        }
        if (energy < 0.5f) {
            /* Very low energy — skip forward */
            pos += 4;
            g_dbg_energy_skip++;
            continue;
        }

        /* Try long sync first (more common for aircraft position) */
        g_dbg_sync_checks++;
        int long_match = correlate_sync(fm_out, n_fm, pos, SYNC_LONG);
        if (long_match > g_dbg_best_long_corr) g_dbg_best_long_corr = long_match;
        if (long_match >= SYNC_THRESHOLD && pos + min_remaining_long <= n_fm) {
            g_dbg_long_match++;
            /* Extract message bits after sync */
            int data_start = pos + sync_samples;
            uint8_t bits[LONG_MSG_BITS];
            int got = slice_bits(fm_out, n_fm, data_start, bits, LONG_MSG_BITS);

            if (got == LONG_MSG_BITS) {
                uint8_t msg_bytes[LONG_MSG_BYTES];
                bits_to_bytes(bits, msg_bytes, LONG_MSG_BITS);

                /* CRC validation */
                if (check_uat_crc(msg_bytes, LONG_MSG_BYTES)) {
                    g_dbg_long_crc_ok++;
                    parse_uat_long_message(msg_bytes, LONG_MSG_BYTES);
                    decoded++;

                    /* Write raw hex 'M' frame */
                    int hex_len = LONG_MSG_BYTES * 2;
                    char hex[LONG_MSG_BYTES * 2 + 1];
                    for (int b = 0; b < LONG_MSG_BYTES; b++)
                        sprintf(hex + b * 2, "%02X", msg_bytes[b]);
                    hex[hex_len] = '\0';

                    uint8_t tag = 'M';
                    uint32_t len = (uint32_t)hex_len;
                    fwrite(&tag, 1, 1, stdout);
                    fwrite(&len, 4, 1, stdout);
                    fwrite(hex, 1, hex_len, stdout);
                    fflush(stdout);

                    /* Skip past this message */
                    pos += min_remaining_long;
                    continue;
                } else {
                    g_dbg_long_crc_fail++;
                }
            }
        }

        /* Try short sync */
        int short_match = correlate_sync(fm_out, n_fm, pos, SYNC_SHORT);
        if (short_match > g_dbg_best_short_corr) g_dbg_best_short_corr = short_match;
        if (short_match >= SYNC_THRESHOLD) {
            g_dbg_short_match++;
            int data_start = pos + sync_samples;
            uint8_t bits[SHORT_MSG_BITS];
            int got = slice_bits(fm_out, n_fm, data_start, bits, SHORT_MSG_BITS);

            if (got == SHORT_MSG_BITS) {
                uint8_t msg_bytes[SHORT_MSG_BYTES];
                bits_to_bytes(bits, msg_bytes, SHORT_MSG_BITS);

                if (check_uat_crc(msg_bytes, SHORT_MSG_BYTES)) {
                    g_dbg_short_crc_ok++;
                    parse_uat_short_message(msg_bytes, SHORT_MSG_BYTES);
                    decoded++;

                    /* Write raw hex 'M' frame */
                    int hex_len = SHORT_MSG_BYTES * 2;
                    char hex[SHORT_MSG_BYTES * 2 + 1];
                    for (int b = 0; b < SHORT_MSG_BYTES; b++)
                        sprintf(hex + b * 2, "%02X", msg_bytes[b]);
                    hex[hex_len] = '\0';

                    uint8_t tag = 'M';
                    uint32_t len = (uint32_t)hex_len;
                    fwrite(&tag, 1, 1, stdout);
                    fwrite(&len, 4, 1, stdout);
                    fwrite(hex, 1, hex_len, stdout);
                    fflush(stdout);

                    pos += min_remaining_short;
                    continue;
                }
            }
        }

        pos++;
    }

    return decoded;
}

/* ── JSON report generation ──────────────────────────────────── */

static void write_decoded_frame(double elapsed_s) {
    char buf[32768];
    int pos = 0;
    int64_t now = now_ms();

    double msg_rate = (elapsed_s > 0.01) ? g_msgs_since_report / elapsed_s : 0.0;

    pos += sprintf(buf + pos, "{\"aircraft\":[");

    int first = 1;
    int count = 0;
    for (int i = 0; i < MAX_AIRCRAFT; i++) {
        if (!g_aircraft[i].active) continue;
        aircraft_t *ac = &g_aircraft[i];
        double age_s = (now - ac->last_seen) / 1000.0;

        if (!first) buf[pos++] = ',';
        first = 0;

        pos += sprintf(buf + pos, "{\"icao\":\"%06X\",\"source\":\"uat\"", ac->icao);

        if (ac->callsign[0] != '\0')
            pos += sprintf(buf + pos, ",\"callsign\":\"%s\"", ac->callsign);
        else
            pos += sprintf(buf + pos, ",\"callsign\":null");

        if (ac->has_position)
            pos += sprintf(buf + pos, ",\"lat\":%.4f,\"lon\":%.4f",
                           ac->latitude, ac->longitude);
        else
            pos += sprintf(buf + pos, ",\"lat\":null,\"lon\":null");

        if (ac->altitude_ft != 0)
            pos += sprintf(buf + pos, ",\"alt_ft\":%d", ac->altitude_ft);
        else
            pos += sprintf(buf + pos, ",\"alt_ft\":null");

        if (ac->ground_speed_kt > 0.0)
            pos += sprintf(buf + pos, ",\"gs_kt\":%.1f", ac->ground_speed_kt);
        else
            pos += sprintf(buf + pos, ",\"gs_kt\":null");

        if (ac->heading_deg > 0.0 || ac->ground_speed_kt > 0.0)
            pos += sprintf(buf + pos, ",\"hdg\":%.1f", ac->heading_deg);
        else
            pos += sprintf(buf + pos, ",\"hdg\":null");

        if (ac->vertical_rate_fpm != 0)
            pos += sprintf(buf + pos, ",\"vr_fpm\":%d", ac->vertical_rate_fpm);
        else
            pos += sprintf(buf + pos, ",\"vr_fpm\":null");

        pos += sprintf(buf + pos, ",\"on_ground\":%s", ac->on_ground ? "true" : "false");
        pos += sprintf(buf + pos, ",\"msgs\":%d", ac->messages);
        pos += sprintf(buf + pos, ",\"age_s\":%.1f}", age_s);

        count++;
    }

    pos += sprintf(buf + pos, "],\"total_msgs\":%d,\"msg_rate\":%.1f,\"aircraft_count\":%d}",
                   g_total_msgs, msg_rate, count);

    /* Write 'D' frame */
    uint8_t tag = 'D';
    uint32_t payload_len = (uint32_t)pos;
    fwrite(&tag, 1, 1, stdout);
    fwrite(&payload_len, 4, 1, stdout);
    fwrite(buf, 1, pos, stdout);
    fflush(stdout);

    g_msgs_since_report = 0;
}

/* ── Write spectrum frame ─────────────────────────────────────── */

static void write_spectrum_frame(const float *bins, int n_bins,
                                 uint32_t center_freq) {
    uint8_t tag = 'S';
    uint32_t payload_len = 4 + (uint32_t)(n_bins * sizeof(float));
    fwrite(&tag, 1, 1, stdout);
    fwrite(&payload_len, 4, 1, stdout);
    fwrite(&center_freq, 4, 1, stdout);
    fwrite(bins, sizeof(float), n_bins, stdout);
    fflush(stdout);
}

/* ── Test mode: generate synthetic UAT messages ───────────────── */
/*
 * Builds a synthetic IQ buffer containing CPFSK-modulated UAT
 * messages with valid sync words and CRC, so the decoder pipeline
 * can be verified without hardware.
 */

static void build_uat_test_long_msg(uint8_t *msg, uint32_t icao,
                                     double lat, double lon,
                                     int alt_ft, int gs_kt,
                                     double hdg_deg,
                                     const char *callsign) {
    memset(msg, 0, LONG_MSG_BYTES);

    /* Payload type 2 (ADS-B with mode status + callsign) */
    int ptype = (callsign != NULL) ? 2 : 1;
    msg[0] = (uint8_t)(ptype << 3);

    /* ICAO */
    msg[1] = (icao >> 16) & 0xFF;
    msg[2] = (icao >>  8) & 0xFF;
    msg[3] =  icao        & 0xFF;

    /* Latitude: 24-bit signed, lat / (360 / 2^24) */
    int32_t lat_raw = (int32_t)(lat / (360.0 / 16777216.0));
    msg[4] = (lat_raw >> 16) & 0xFF;
    msg[5] = (lat_raw >>  8) & 0xFF;
    msg[6] =  lat_raw        & 0xFF;

    /* Longitude: 24-bit signed */
    int32_t lon_raw = (int32_t)(lon / (360.0 / 16777216.0));
    msg[7] = (lon_raw >> 16) & 0xFF;
    msg[8] = (lon_raw >>  8) & 0xFF;
    msg[9] =  lon_raw        & 0xFF;

    /* Altitude: code = (alt + 1000) / 25, stored as 12-bit in bytes 10-11 */
    int alt_code = (alt_ft + 1000) / 25;
    if (alt_code < 0) alt_code = 0;
    if (alt_code > 4095) alt_code = 4095;
    msg[10] = (msg[10] & 0xF0) | ((alt_code >> 8) & 0x0F);
    msg[11] = alt_code & 0xFF;

    /* Ground speed: 9-bit value in byte 12 [7:0] + byte 13 [7] */
    int gs_val = gs_kt;
    if (gs_val < 0) gs_val = 0;
    if (gs_val > 511) gs_val = 511;
    msg[12] = (gs_val >> 1) & 0xFF;
    msg[13] = (msg[13] & 0x7F) | ((gs_val & 0x01) << 7);

    /* Heading: 8-bit value = hdg / (360/256), in byte 13 [6:0] + byte 14 [7] */
    int hdg_val = (int)(hdg_deg / (360.0 / 256.0));
    if (hdg_val < 0) hdg_val += 256;
    hdg_val &= 0xFF;
    msg[13] = (msg[13] & 0x80) | ((hdg_val >> 1) & 0x7F);
    msg[14] = (msg[14] & 0x7F) | ((hdg_val & 0x01) << 7);

    /* Vertical rate: offset binary, 1024 = 0 fpm, 64 fpm/count
     * Store zero for test messages */
    int vr_code = 1024;  /* 0 fpm */
    msg[14] = (msg[14] & 0x80) | ((vr_code >> 4) & 0x7F);
    msg[15] = (msg[15] & 0x0F) | ((vr_code & 0x0F) << 4);

    /* Callsign for payload type 2: encode 8 chars at bytes 17-22 */
    if (callsign != NULL && ptype == 2) {
        uint64_t chars = 0;
        for (int i = 0; i < 8; i++) {
            int idx = 32;  /* space */
            char c = (callsign[i]) ? callsign[i] : ' ';
            if (c == '\0') { /* pad rest with spaces */
                for (int j = i; j < 8; j++)
                    chars = (chars << 6) | 32;
                break;
            }
            if (c >= 'A' && c <= 'Z') idx = c - 'A' + 1;
            else if (c >= '0' && c <= '9') idx = c - '0' + 48;
            else if (c == ' ') idx = 32;
            chars = (chars << 6) | (idx & 0x3F);
        }
        msg[17] = (chars >> 40) & 0xFF;
        msg[18] = (chars >> 32) & 0xFF;
        msg[19] = (chars >> 24) & 0xFF;
        msg[20] = (chars >> 16) & 0xFF;
        msg[21] = (chars >>  8) & 0xFF;
        msg[22] =  chars        & 0xFF;
    }

    /* CRC-24 over first 31 bytes, store in bytes 31-33 */
    int data_len = LONG_MSG_BYTES - 3;  /* 31 */
    uint32_t crc = compute_crc(msg, data_len);
    msg[data_len]     = (crc >> 16) & 0xFF;
    msg[data_len + 1] = (crc >>  8) & 0xFF;
    msg[data_len + 2] =  crc        & 0xFF;
}

static void build_uat_test_short_msg(uint8_t *msg, uint32_t icao) {
    memset(msg, 0, SHORT_MSG_BYTES);

    /* Payload type 1 */
    msg[0] = (1 << 3);

    /* ICAO */
    msg[1] = (icao >> 16) & 0xFF;
    msg[2] = (icao >>  8) & 0xFF;
    msg[3] =  icao        & 0xFF;

    /* CRC-24 over first 15 bytes */
    int data_len = SHORT_MSG_BYTES - 3;  /* 15 */
    uint32_t crc = compute_crc(msg, data_len);
    msg[data_len]     = (crc >> 16) & 0xFF;
    msg[data_len + 1] = (crc >>  8) & 0xFF;
    msg[data_len + 2] =  crc        & 0xFF;
}

/*
 * Inject a CPFSK-modulated UAT message into a raw IQ buffer.
 * Generates a carrier at baseband with frequency deviation encoding
 * the sync word followed by message bits.
 *
 * offset:    byte offset into raw_buf (IQ pairs start at offset)
 * sync_word: 36-bit sync
 * msg_bytes: message payload
 * msg_len:   number of message bytes
 */
static void inject_uat_signal(uint8_t *raw_buf, int offset,
                               uint64_t sync_word,
                               const uint8_t *msg_bytes, int msg_len) {
    int msg_bits = msg_len * 8;
    int total_bits = SYNC_BITS + msg_bits;
    int total_samples = total_bits * SAMPLES_PER_BIT;

    /* Build bit array: sync + message */
    uint8_t *all_bits = (uint8_t *)malloc(total_bits);
    if (!all_bits) return;

    /* Sync word bits */
    for (int b = 0; b < SYNC_BITS; b++) {
        all_bits[b] = (uint8_t)((sync_word >> (SYNC_BITS - 1 - b)) & 1);
    }
    /* Message bits */
    for (int b = 0; b < msg_bits; b++) {
        all_bits[SYNC_BITS + b] = (msg_bytes[b >> 3] >> (7 - (b & 7))) & 1;
    }

    /*
     * Generate CPFSK: carrier with frequency deviation.
     * bit=1 -> positive freq deviation -> phase increases
     * bit=0 -> negative freq deviation -> phase decreases
     *
     * The FM discriminator recovers sign of freq, so we need
     * the phase difference between consecutive samples to be
     * positive for bit=1 and negative for bit=0.
     */
    float phase = 0.0f;
    float dev = 0.8f;   /* phase increment per sample for a '1' bit */
    float amplitude = 80.0f;  /* signal amplitude (above noise floor) */

    for (int s = 0; s < total_samples; s++) {
        int bit_idx = s / SAMPLES_PER_BIT;
        if (bit_idx >= total_bits) break;

        float freq = all_bits[bit_idx] ? dev : -dev;
        phase += freq;

        /* Keep phase in [-pi, pi] */
        while (phase >  PI_F) phase -= 2.0f * PI_F;
        while (phase < -PI_F) phase += 2.0f * PI_F;

        float i_val = amplitude * cosf(phase) + 127.5f;
        float q_val = amplitude * sinf(phase) + 127.5f;

        /* Clamp to uint8 range */
        int ii = (int)(i_val + 0.5f);
        int qq = (int)(q_val + 0.5f);
        if (ii < 0) ii = 0; if (ii > 255) ii = 255;
        if (qq < 0) qq = 0; if (qq > 255) qq = 255;

        int buf_idx = offset + s * 2;
        raw_buf[buf_idx]     = (uint8_t)ii;
        raw_buf[buf_idx + 1] = (uint8_t)qq;
    }

    free(all_bits);
}

/* ── Parse command line ──────────────────────────────────────── */

static int parse_args(int argc, char **argv, int *gain, int *device,
                      int *test_mode, char **device_serial) {
    *gain = 496;            /* 49.6 dB */
    *device = 0;
    *test_mode = 0;
    *device_serial = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--gain") == 0 && i + 1 < argc) {
            *gain = atoi(argv[++i]);
        } else if (strcmp(argv[i], "--device") == 0 && i + 1 < argc) {
            *device = atoi(argv[++i]);
        } else if (strcmp(argv[i], "--device-serial") == 0 && i + 1 < argc) {
            *device_serial = argv[++i];
        } else if (strcmp(argv[i], "--test") == 0) {
            *test_mode = 1;
        } else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            fprintf(stderr,
                "groundlink_uat -- Fast C UAT (978 MHz) ADS-B decoder for GROUNDLINK\n\n"
                "Usage: groundlink_uat [options]\n"
                "  --gain TENTH         Gain in tenths of dB (default: 496 = 49.6 dB)\n"
                "  --device N           RTL-SDR device index (default: 0)\n"
                "  --device-serial SN   Select RTL-SDR by serial number\n"
                "  --test               Test mode: synthetic messages, no hardware\n");
            return -1;
        }
    }
    return 0;
}

/* ── Main ────────────────────────────────────────────────────── */

int main(int argc, char **argv) {
    int gain, device, test_mode;
    char *device_serial = NULL;

    if (parse_args(argc, argv, &gain, &device, &test_mode, &device_serial) != 0)
        return 1;

    /* Set stdout to binary mode (Windows) */
#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
#endif

    signal(SIGINT, sighandler);
    signal(SIGTERM, sighandler);

    /* Initialize lookup tables */
    init_mag_lut();
    init_crc_table();
    init_hann();
    memset(g_aircraft, 0, sizeof(g_aircraft));

    fprintf(stderr, "GROUNDLINK UAT (978 MHz) Decoder\n");

    /* ── Allocate buffers ── */
    uint8_t *raw_buf = (uint8_t *)malloc(CAPTURE_BYTES);
    float *fm_out = (float *)malloc(CAPTURE_IQ * sizeof(float));
    float spectrum[SPECTRUM_BINS];

    if (!raw_buf || !fm_out) {
        fprintf(stderr, "ERROR: Memory allocation failed\n");
        free(raw_buf);
        free(fm_out);
        return 1;
    }

    rtlsdr_dev_t *dev = NULL;

    if (!test_mode) {
        /* ── Resolve device by serial if specified ── */
        if (device_serial != NULL) {
            int idx = rtlsdr_get_index_by_serial(device_serial);
            if (idx < 0) {
                fprintf(stderr, "ERROR: No RTL-SDR with serial '%s' found\n",
                        device_serial);
                free(raw_buf);
                free(fm_out);
                return 1;
            }
            device = idx;
            fprintf(stderr, "Found device serial '%s' at index %d\n",
                    device_serial, device);
        }

        /* ── Open RTL-SDR ── */
        uint32_t dev_count = rtlsdr_get_device_count();
        if (dev_count == 0) {
            fprintf(stderr, "ERROR: No RTL-SDR devices found\n");
            free(raw_buf);
            free(fm_out);
            return 1;
        }
        fprintf(stderr, "Found %u RTL-SDR device(s)\n", dev_count);

        if (rtlsdr_open(&dev, (uint32_t)device) != 0) {
            fprintf(stderr, "ERROR: Failed to open RTL-SDR device %d\n", device);
            free(raw_buf);
            free(fm_out);
            return 1;
        }

        rtlsdr_set_sample_rate(dev, UAT_SAMPLE_RATE);
        rtlsdr_set_center_freq(dev, UAT_FREQ);
        rtlsdr_set_tuner_gain_mode(dev, 1);   /* manual gain */
        rtlsdr_set_tuner_gain(dev, gain);
        rtlsdr_set_agc_mode(dev, 0);
        rtlsdr_reset_buffer(dev);

        fprintf(stderr, "SDR: freq=%u Hz, rate=%u, gain=%.1f dB\n",
                UAT_FREQ, UAT_SAMPLE_RATE, gain / 10.0f);
    } else {
        fprintf(stderr, "TEST MODE: generating synthetic UAT messages\n");
    }

    int frame_count = 0;
    int64_t last_report = now_ms();

    /* ── Main loop ── */
    while (g_running) {
        int n_read = 0;

        if (test_mode) {
            /* Generate synthetic data: baseline silence */
            memset(raw_buf, 128, CAPTURE_BYTES);

            /* Inject test UAT long message: aircraft near Seattle */
            uint8_t test_long[LONG_MSG_BYTES];
            build_uat_test_long_msg(test_long, 0xA12345,
                                     47.45, -122.31,
                                     35000, 250, 180.0,
                                     "UAL1532");
            inject_uat_signal(raw_buf, 2000, SYNC_LONG,
                              test_long, LONG_MSG_BYTES);

            /* Inject second long message: aircraft near Portland */
            uint8_t test_long2[LONG_MSG_BYTES];
            build_uat_test_long_msg(test_long2, 0xB67890,
                                     45.52, -122.68,
                                     18000, 180, 45.0,
                                     "SWA4291");
            inject_uat_signal(raw_buf, 10000, SYNC_LONG,
                              test_long2, LONG_MSG_BYTES);

            /* Inject a short message */
            uint8_t test_short[SHORT_MSG_BYTES];
            build_uat_test_short_msg(test_short, 0xC11111);
            inject_uat_signal(raw_buf, 20000, SYNC_SHORT,
                              test_short, SHORT_MSG_BYTES);

            n_read = CAPTURE_BYTES;

            /* Slow down test mode to ~real-time */
#ifdef _WIN32
            Sleep(126);
#else
            usleep(126000);
#endif
        } else {
            int r = rtlsdr_read_sync(dev, raw_buf, CAPTURE_BYTES, &n_read);
            if (r != 0 || n_read != CAPTURE_BYTES) {
                fprintf(stderr, "WARNING: read_sync returned %d, got %d bytes\n",
                        r, n_read);
                if (r != 0) break;
                continue;
            }
        }

        int n_iq = n_read / 2;

        /* FM discriminate: raw IQ -> instantaneous frequency */
        fm_discriminate(raw_buf, fm_out, n_iq);

        /* Detect sync words and decode messages */
        detect_and_decode_uat(fm_out, n_iq, raw_buf);

        /* Age out stale aircraft */
        int64_t now = now_ms();
        age_aircraft(now);

        frame_count++;

        /* Debug output every 8 blocks (~1 second) */
        if (frame_count % 8 == 0) {
            fprintf(stderr, "[UAT dbg] blk=%d chk=%d skip=%d | long: best=%d/%d match=%d crc_ok=%d fail=%d | short: best=%d/%d match=%d crc_ok=%d\n",
                    frame_count, g_dbg_sync_checks, g_dbg_energy_skip,
                    g_dbg_best_long_corr, SYNC_THRESHOLD, g_dbg_long_match,
                    g_dbg_long_crc_ok, g_dbg_long_crc_fail,
                    g_dbg_best_short_corr, SYNC_THRESHOLD, g_dbg_short_match,
                    g_dbg_short_crc_ok);
        }

        /* Emit spectrum (every SPECTRUM_INTERVAL blocks) */
        if (frame_count % SPECTRUM_INTERVAL == 0) {
            compute_spectrum(raw_buf, n_read, UAT_FREQ, spectrum);
            write_spectrum_frame(spectrum, SPECTRUM_BINS, UAT_FREQ);
        }

        /* Emit aircraft report (every REPORT_INTERVAL blocks, ~1 second) */
        if (frame_count % REPORT_INTERVAL == 0) {
            double elapsed = (now - last_report) / 1000.0;
            write_decoded_frame(elapsed);
            last_report = now;
        }
    }

    /* ── Cleanup ── */
    fprintf(stderr, "Shutting down... %d total messages decoded\n", g_total_msgs);
    if (dev) rtlsdr_close(dev);
    free(raw_buf);
    free(fm_out);

    return 0;
}
