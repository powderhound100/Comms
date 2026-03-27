/*
 * groundlink_adsb.c — Fast C ADS-B (Mode S) decoder for GROUNDLINK.
 *
 * Reads raw IQ from RTL-SDR at 1090 MHz / 2 Msps, detects ADS-B preambles,
 * extracts and CRC-validates Mode S Extended Squitter messages, decodes
 * aircraft position/velocity/identity, and outputs binary frames on stdout
 * for the Python WebSocket server to forward to the browser.
 *
 * Build:  build_adsb.bat  (MSVC cl.exe + rtlsdr.lib)
 * Usage:  groundlink_adsb.exe [--gain 496] [--device 0] [--test]
 *
 * Output protocol (stdout, binary):
 *   Decoded frame:  'D' (1B) + length (uint32 LE) + UTF-8 JSON
 *   Spectrum frame: 'S' (1B) + length (uint32 LE) + center_freq (uint32 LE) + float[] dBFS
 *   Raw msg frame:  'M' (1B) + length (uint32 LE) + hex string (28 chars)
 */

#ifdef _MSC_VER
#define _CRT_SECURE_NO_WARNINGS
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdint.h>
#include <fcntl.h>
#ifdef _WIN32
#include <io.h>
#else
#include <unistd.h>
#endif
#include <signal.h>
#include <time.h>

#ifdef _WIN32
#include <windows.h>
#endif

#include "rtlsdr.h"

/* ── Constants ─────────────────────────────────────────────────── */

#define ADSB_FREQ       1090000000      /* 1090 MHz */
#define SAMPLE_RATE     2000000         /* 2 Msps = 2 samples per ADS-B bit */
#define CAPTURE_BYTES   524288          /* 262144 IQ pairs (~131 ms at 2M) */
#define CAPTURE_IQ      (CAPTURE_BYTES / 2)

#define PREAMBLE_SAMPLES 16             /* 8 us * 2 samples/us */
#define MSG_BITS_LONG    112            /* DF17 extended squitter */
#define MSG_SAMPLES_LONG (PREAMBLE_SAMPLES + MSG_BITS_LONG * 2)  /* 240 */

#define MAX_AIRCRAFT    256
#define AIRCRAFT_TIMEOUT_MS 60000       /* 60 seconds */
#define CPR_TIMEOUT_MS  10000           /* 10 seconds for even/odd pair */

#define FFT_SIZE        1024
#define SPECTRUM_BINS   256             /* FFT_SIZE / 4 */
#define PI_F            3.14159265358979f

#define REPORT_INTERVAL 8               /* emit 'D' frame every N blocks (~1s) */
#define SPECTRUM_INTERVAL 10            /* emit 'S' frame every N blocks */

/* ── Globals ───────────────────────────────────────────────────── */

static volatile int g_running = 1;

static void sighandler(int sig) {
    (void)sig;
    g_running = 0;
}

/* ── Magnitude lookup table ──────────────────────────────────── */
/* 256x256 = 65536 entries, each uint16. Maps raw uint8 I,Q → magnitude.
 * Eliminates per-sample float conversion + sqrt. ~128 KB, fits in L2. */

static uint16_t g_mag_lut[65536];

static void init_mag_lut(void) {
    for (int i = 0; i < 256; i++) {
        for (int q = 0; q < 256; q++) {
            float fi = (i - 127.5f) / 128.0f;
            float fq = (q - 127.5f) / 128.0f;
            float mag = sqrtf(fi * fi + fq * fq);
            /* Scale to uint16 range. Max magnitude is sqrt(2) ≈ 1.414 */
            uint32_t val = (uint32_t)(mag * 65535.0f / 1.414f);
            if (val > 65535) val = 65535;
            g_mag_lut[i * 256 + q] = (uint16_t)val;
        }
    }
}

/* ── CRC-24 lookup table ─────────────────────────────────────── */
/* ADS-B generator polynomial: x^24 + x^23 + x^22 + ... = 0x1FFF409
 * Byte-at-a-time CRC for speed (14 iterations vs 112 bit ops). */

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

static int check_crc(const uint8_t *msg) {
    /* For DF17: CRC of all 14 bytes should be 0 */
    return compute_crc(msg, 14) == 0;
}

/* ── FFT + Spectrum (copied from groundlink_radio.c) ─────────── */

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

    /* CPR state: [0]=even, [1]=odd */
    double   cpr_lat[2];
    double   cpr_lon[2];
    int64_t  cpr_time[2];

    int64_t  last_seen;   /* ms since epoch */
    int      active;      /* slot in use */
} aircraft_t;

static aircraft_t g_aircraft[MAX_AIRCRAFT];
static int g_total_msgs = 0;
static int g_msgs_since_report = 0;

static int64_t now_ms(void) {
    struct timespec ts;
    timespec_get(&ts, TIME_UTC);
    return (int64_t)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static aircraft_t *find_aircraft(uint32_t icao) {
    /* Linear scan — at MAX_AIRCRAFT=256 this is trivially fast */
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

    /* Table full — evict oldest */
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

/* ── ADS-B callsign charset ──────────────────────────────────── */

static const char ADSB_CHARSET[] =
    "#ABCDEFGHIJKLMNOPQRSTUVWXYZ##### ###############0123456789######";

/* ── CPR decode helpers ──────────────────────────────────────── */

static int cpr_nl(double lat) {
    /* Number of longitude zones for a given latitude */
    if (fabs(lat) >= 87.0) return 1;
    double nz = 15.0;
    double tmp = 1.0 - cos(PI_F / (2.0 * nz));
    double cos_lat = cos(PI_F / 180.0 * lat);
    double val = 1.0 - tmp / (cos_lat * cos_lat);
    if (val < -1.0) val = -1.0;
    if (val > 1.0) val = 1.0;
    return (int)floor(2.0 * PI_F / acos(val));
}

static int cpr_decode_global(aircraft_t *ac) {
    /* Need both even and odd within CPR_TIMEOUT_MS */
    if (ac->cpr_time[0] == 0 || ac->cpr_time[1] == 0)
        return 0;
    if (llabs(ac->cpr_time[0] - ac->cpr_time[1]) > CPR_TIMEOUT_MS)
        return 0;

    double lat0 = ac->cpr_lat[0];
    double lon0 = ac->cpr_lon[0];
    double lat1 = ac->cpr_lat[1];
    double lon1 = ac->cpr_lon[1];

    double d_lat0 = 360.0 / 60.0;
    double d_lat1 = 360.0 / 59.0;

    int j = (int)floor(59.0 * lat0 - 60.0 * lat1 + 0.5);

    double lat_even = d_lat0 * ((j % 60) + lat0);
    double lat_odd  = d_lat1 * ((j % 59) + lat1);

    if (lat_even >= 270.0) lat_even -= 360.0;
    if (lat_odd >= 270.0)  lat_odd -= 360.0;

    int nl_even = cpr_nl(lat_even);
    int nl_odd  = cpr_nl(lat_odd);
    if (nl_even != nl_odd) return 0;  /* zone mismatch */

    double lat, lon;

    if (ac->cpr_time[0] >= ac->cpr_time[1]) {
        /* Use even frame */
        lat = lat_even;
        int nl = nl_even;
        if (nl < 1) nl = 1;
        int m = (int)floor(lon0 * (nl - 1) - lon1 * nl + 0.5);
        double d_lon = (nl > 0) ? 360.0 / nl : 360.0;
        lon = d_lon * ((m % nl + nl) % nl + lon0);
    } else {
        /* Use odd frame */
        lat = lat_odd;
        int nl = nl_odd - 1;
        if (nl < 1) nl = 1;
        int m = (int)floor(lon0 * (nl - 1) - lon1 * nl + 0.5);
        double d_lon = (nl > 0) ? 360.0 / nl : 360.0;
        lon = d_lon * ((m % nl + nl) % nl + lon1);
    }

    if (lon > 180.0) lon -= 360.0;

    if (lat < -90.0 || lat > 90.0 || lon < -180.0 || lon > 180.0)
        return 0;

    ac->latitude = lat;
    ac->longitude = lon;
    ac->has_position = 1;
    return 1;
}

/* ── Message parsing ─────────────────────────────────────────── */

static void parse_identification(aircraft_t *ac, const uint8_t *msg) {
    /* TC 1-4: callsign from ME bytes 1-6 (48 bits = 8 chars * 6 bits) */
    uint64_t chars = 0;
    for (int i = 5; i < 11; i++)
        chars = (chars << 8) | msg[i];

    for (int i = 0; i < 8; i++) {
        int idx = (int)((chars >> (42 - i * 6)) & 0x3F);
        if (idx >= 0 && idx < 64)
            ac->callsign[i] = ADSB_CHARSET[idx];
        else
            ac->callsign[i] = ' ';
    }
    ac->callsign[8] = '\0';

    /* Trim trailing spaces */
    for (int i = 7; i >= 0; i--) {
        if (ac->callsign[i] == ' ' || ac->callsign[i] == '#')
            ac->callsign[i] = '\0';
        else
            break;
    }
}

static void parse_airborne_position(aircraft_t *ac, const uint8_t *msg) {
    /* TC 9-18: altitude + CPR position */
    int alt_bits = ((msg[5] & 0xFF) << 4) | ((msg[6] >> 4) & 0x0F);
    int q_bit = (alt_bits >> 4) & 1;
    if (q_bit) {
        int n = ((alt_bits >> 5) << 4) | (alt_bits & 0x0F);
        ac->altitude_ft = n * 25 - 1000;
    }

    int cpr_flag = (msg[6] >> 2) & 1;  /* 0=even, 1=odd */
    int lat_raw = ((msg[6] & 0x03) << 15) | (msg[7] << 7) | (msg[8] >> 1);
    int lon_raw = ((msg[8] & 0x01) << 16) | (msg[9] << 8) | msg[10];

    ac->cpr_lat[cpr_flag] = lat_raw / 131072.0;
    ac->cpr_lon[cpr_flag] = lon_raw / 131072.0;
    ac->cpr_time[cpr_flag] = now_ms();
    ac->on_ground = 0;

    cpr_decode_global(ac);
}

static void parse_surface_position(aircraft_t *ac, const uint8_t *msg) {
    (void)msg;
    ac->on_ground = 1;
}

static void parse_velocity(aircraft_t *ac, const uint8_t *msg) {
    /* TC 19: ground speed, heading, vertical rate */
    int subtype = msg[4] & 0x07;

    if (subtype == 1 || subtype == 2) {
        int ew_sign = (msg[5] >> 2) & 1;
        int ew_vel  = ((msg[5] & 0x03) << 8) | msg[6];
        int ns_sign = (msg[7] >> 7) & 1;
        int ns_vel  = ((msg[7] & 0x7F) << 3) | (msg[8] >> 5);

        double ew = (double)(ew_vel - 1) * (ew_sign ? -1.0 : 1.0);
        double ns = (double)(ns_vel - 1) * (ns_sign ? -1.0 : 1.0);

        if (subtype == 2) {
            ew *= 4.0;  /* supersonic */
            ns *= 4.0;
        }

        ac->ground_speed_kt = sqrt(ew * ew + ns * ns);
        ac->heading_deg = fmod(atan2(ew, ns) * 180.0 / PI_F + 360.0, 360.0);

        int vr_sign = (msg[8] >> 3) & 1;
        int vr_val  = ((msg[8] & 0x07) << 6) | (msg[9] >> 2);
        if (vr_val > 0) {
            ac->vertical_rate_fpm = (vr_val - 1) * 64 * (vr_sign ? -1 : 1);
        }
    }
}

static void parse_adsb_message(const uint8_t *msg) {
    /* Extract ICAO address (bytes 1-3) */
    uint32_t icao = ((uint32_t)msg[1] << 16) | ((uint32_t)msg[2] << 8) | msg[3];
    int tc = (msg[4] >> 3) & 0x1F;

    aircraft_t *ac = get_or_create_aircraft(icao);
    ac->last_seen = now_ms();
    ac->messages++;
    g_total_msgs++;
    g_msgs_since_report++;

    if (tc >= 1 && tc <= 4) {
        parse_identification(ac, msg);
    } else if (tc >= 9 && tc <= 18) {
        parse_airborne_position(ac, msg);
    } else if (tc == 19) {
        parse_velocity(ac, msg);
    } else if (tc >= 5 && tc <= 8) {
        parse_surface_position(ac, msg);
    }
}

/* ── Preamble detection + bit extraction ─────────────────────── */

static int detect_and_decode(const uint16_t *mag, int n_samples) {
    int decoded = 0;
    int i = 0;

    while (i < n_samples - MSG_SAMPLES_LONG) {
        /*
         * ADS-B preamble at 2 Msps (16 samples):
         *   positions 0,2,7,9 = HIGH (pulses)
         *   positions 1,3,4,5,6,8,10-15 = LOW (gaps)
         *
         * Check: each high > adjacent lows, highs > mid gaps
         */
        uint16_t m0 = mag[i + 0];
        uint16_t m1 = mag[i + 1];
        uint16_t m2 = mag[i + 2];
        uint16_t m3 = mag[i + 3];
        uint16_t m4 = mag[i + 4];
        uint16_t m5 = mag[i + 5];
        uint16_t m7 = mag[i + 7];
        uint16_t m8 = mag[i + 8];
        uint16_t m9 = mag[i + 9];

        /* Quick reject: pulse positions must exceed adjacent gaps */
        if (m0 <= m1 || m2 <= m3 || m7 <= m8 || m9 <= mag[i + 10]) {
            i++;
            continue;
        }

        /* Pulses must exceed the inter-pulse gaps */
        if (m0 <= m4 || m0 <= m5 || m2 <= m4 || m2 <= m5) {
            i++;
            continue;
        }

        /* Minimum signal strength: average of 4 high samples */
        uint32_t high_avg = ((uint32_t)m0 + m2 + m7 + m9) >> 2;
        if (high_avg < 200) {  /* noise threshold */
            i++;
            continue;
        }

        /* Extract 112 bits via PPM: compare first vs second sample of each bit */
        uint8_t msg_bytes[14];
        memset(msg_bytes, 0, 14);
        int bit_start = i + PREAMBLE_SAMPLES;

        for (int b = 0; b < MSG_BITS_LONG; b++) {
            if (mag[bit_start + b * 2] > mag[bit_start + b * 2 + 1]) {
                msg_bytes[b >> 3] |= (uint8_t)(1 << (7 - (b & 7)));
            }
        }

        /* Check downlink format */
        int df = (msg_bytes[0] >> 3) & 0x1F;

        if (df == 17) {
            /* ADS-B Extended Squitter — CRC-24 validate */
            if (check_crc(msg_bytes)) {
                parse_adsb_message(msg_bytes);
                decoded++;

                /* Write raw hex 'M' frame */
                char hex[29];
                for (int b = 0; b < 14; b++)
                    sprintf(hex + b * 2, "%02X", msg_bytes[b]);
                hex[28] = '\0';

                uint8_t tag = 'M';
                uint32_t len = 28;
                fwrite(&tag, 1, 1, stdout);
                fwrite(&len, 4, 1, stdout);
                fwrite(hex, 1, 28, stdout);
                fflush(stdout);

                /* Skip past this message */
                i += MSG_SAMPLES_LONG;
                continue;
            }
        } else if (df == 11) {
            /* DF11: All-Call Reply — contains ICAO, useful for tracking
             * even though it has no position data. 56-bit message. */
            if (compute_crc(msg_bytes, 7) == 0) {
                uint32_t icao = ((uint32_t)msg_bytes[1] << 16) |
                                ((uint32_t)msg_bytes[2] << 8) | msg_bytes[3];
                aircraft_t *ac = get_or_create_aircraft(icao);
                ac->last_seen = now_ms();
                ac->messages++;
                g_total_msgs++;
                g_msgs_since_report++;
            }
        }

        i++;
    }

    return decoded;
}

/* ── JSON report generation ──────────────────────────────────── */

static void write_decoded_frame(double elapsed_s) {
    /* Build JSON aircraft report */
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

        pos += sprintf(buf + pos, "{\"icao\":\"%06X\"", ac->icao);

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

/* ── Test mode: generate synthetic ADS-B messages ─────────────── */

static void inject_test_preamble(uint8_t *raw_buf, int offset,
                                 const uint8_t *msg_bytes) {
    /* Build magnitude-like values in raw IQ buffer.
     * Preamble high samples at positions 0,2,7,9;
     * then 112 PPM-encoded bits. */

    /* Set all to low baseline */
    for (int i = 0; i < MSG_SAMPLES_LONG * 2; i++) {
        raw_buf[offset + i] = 128;  /* ~0 magnitude */
    }

    /* Preamble pulses: set I high (200) at positions 0,2,7,9 */
    int preamble_highs[] = {0, 2, 7, 9};
    for (int p = 0; p < 4; p++) {
        int s = preamble_highs[p];
        raw_buf[offset + s * 2] = 220;      /* I */
        raw_buf[offset + s * 2 + 1] = 128;  /* Q = 0 */
    }

    /* Encode 112 bits as PPM */
    int bit_start = offset + PREAMBLE_SAMPLES * 2;
    for (int b = 0; b < MSG_BITS_LONG; b++) {
        int bit = (msg_bytes[b >> 3] >> (7 - (b & 7))) & 1;
        if (bit) {
            /* First sample high, second low */
            raw_buf[bit_start + b * 4] = 220;
            raw_buf[bit_start + b * 4 + 1] = 128;
            raw_buf[bit_start + b * 4 + 2] = 128;
            raw_buf[bit_start + b * 4 + 3] = 128;
        } else {
            /* First sample low, second high */
            raw_buf[bit_start + b * 4] = 128;
            raw_buf[bit_start + b * 4 + 1] = 128;
            raw_buf[bit_start + b * 4 + 2] = 220;
            raw_buf[bit_start + b * 4 + 3] = 128;
        }
    }
}

static void build_test_msg(uint8_t *msg, uint32_t icao, int tc,
                           const char *callsign) {
    /* Build a minimal DF=17 message with correct CRC */
    memset(msg, 0, 14);
    msg[0] = (17 << 3) | 5;  /* DF=17, CA=5 */
    msg[1] = (icao >> 16) & 0xFF;
    msg[2] = (icao >> 8) & 0xFF;
    msg[3] = icao & 0xFF;

    if (tc >= 1 && tc <= 4) {
        /* Aircraft identification */
        msg[4] = (uint8_t)(tc << 3);
        /* Encode callsign into 48 bits (ME bytes 5-10) */
        uint64_t chars = 0;
        for (int i = 0; i < 8; i++) {
            int idx = 32;  /* space */
            char c = (callsign && callsign[i]) ? callsign[i] : ' ';
            if (c >= 'A' && c <= 'Z') idx = c - 'A' + 1;
            else if (c >= '0' && c <= '9') idx = c - '0' + 48;
            else if (c == ' ') idx = 32;
            chars = (chars << 6) | (idx & 0x3F);
        }
        msg[5]  = (chars >> 40) & 0xFF;
        msg[6]  = (chars >> 32) & 0xFF;
        msg[7]  = (chars >> 24) & 0xFF;
        msg[8]  = (chars >> 16) & 0xFF;
        msg[9]  = (chars >> 8) & 0xFF;
        msg[10] = chars & 0xFF;
    } else if (tc >= 9 && tc <= 18) {
        /* Airborne position — encode a position near 47.45N, -122.31W at FL350 */
        msg[4] = (uint8_t)(tc << 3);
        /* Altitude: FL350 = 35000 ft → n = (35000+1000)/25 = 1440
         * alt_bits: insert Q-bit at bit 4 = 1
         * n=1440: upper 7 bits = 1440>>4 = 90, lower 4 bits = 1440&0xF = 0
         * alt_code = (90 << 5) | (1 << 4) | 0 = 2896 = 0x0B50 */
        int n = 1440;
        int alt_code = ((n >> 4) << 5) | (1 << 4) | (n & 0x0F);
        msg[5] = (alt_code >> 4) & 0xFF;
        msg[6] = ((alt_code & 0x0F) << 4);

        /* CPR flag = 0 (even) */
        /* lat_raw and lon_raw encoding for ~47.45N, -122.31W */
        int lat_raw = (int)(47.45 / 360.0 * 60 * 131072.0) & 0x1FFFF;
        int lon_raw = (int)((360.0 - 122.31) / 360.0 * 60 * 131072.0) & 0x1FFFF;
        msg[6] |= (lat_raw >> 15) & 0x03;
        msg[7] = (lat_raw >> 7) & 0xFF;
        msg[8] = ((lat_raw & 0x7F) << 1) | ((lon_raw >> 16) & 0x01);
        msg[9] = (lon_raw >> 8) & 0xFF;
        msg[10] = lon_raw & 0xFF;
    }

    /* Compute CRC-24 and store in bytes 11-13 */
    uint32_t crc = compute_crc(msg, 11);
    msg[11] = (crc >> 16) & 0xFF;
    msg[12] = (crc >> 8) & 0xFF;
    msg[13] = crc & 0xFF;
}

/* ── Parse command line ──────────────────────────────────────── */

static int parse_args(int argc, char **argv, int *gain, int *device,
                      int *test_mode) {
    *gain = 496;    /* 49.6 dB — max for ADS-B */
    *device = 0;
    *test_mode = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--gain") == 0 && i + 1 < argc) {
            *gain = atoi(argv[++i]);
        } else if (strcmp(argv[i], "--device") == 0 && i + 1 < argc) {
            *device = atoi(argv[++i]);
        } else if (strcmp(argv[i], "--test") == 0) {
            *test_mode = 1;
        } else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            fprintf(stderr,
                "groundlink_adsb — Fast C ADS-B decoder for GROUNDLINK\n\n"
                "Usage: groundlink_adsb [options]\n"
                "  --gain TENTH  Gain in tenths of dB (default: 496 = 49.6 dB)\n"
                "  --device N    RTL-SDR device index (default: 0)\n"
                "  --test        Test mode: synthetic messages, no hardware\n");
            return -1;
        }
    }
    return 0;
}

/* ── Main ────────────────────────────────────────────────────── */

int main(int argc, char **argv) {
    int gain, device, test_mode;

    if (parse_args(argc, argv, &gain, &device, &test_mode) != 0)
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

    fprintf(stderr, "GROUNDLINK ADS-B Decoder\n");

    /* ── Allocate buffers ── */
    uint8_t *raw_buf = (uint8_t *)malloc(CAPTURE_BYTES);
    uint16_t *mag = (uint16_t *)malloc(CAPTURE_IQ * sizeof(uint16_t));
    float spectrum[SPECTRUM_BINS];

    if (!raw_buf || !mag) {
        fprintf(stderr, "ERROR: Memory allocation failed\n");
        return 1;
    }

    rtlsdr_dev_t *dev = NULL;

    if (!test_mode) {
        /* ── Open RTL-SDR ── */
        uint32_t dev_count = rtlsdr_get_device_count();
        if (dev_count == 0) {
            fprintf(stderr, "ERROR: No RTL-SDR devices found\n");
            free(raw_buf);
            free(mag);
            return 1;
        }
        fprintf(stderr, "Found %u RTL-SDR device(s)\n", dev_count);

        if (rtlsdr_open(&dev, (uint32_t)device) != 0) {
            fprintf(stderr, "ERROR: Failed to open RTL-SDR device %d\n", device);
            free(raw_buf);
            free(mag);
            return 1;
        }

        rtlsdr_set_sample_rate(dev, SAMPLE_RATE);
        rtlsdr_set_center_freq(dev, ADSB_FREQ);
        rtlsdr_set_tuner_gain_mode(dev, 1);   /* manual gain */
        rtlsdr_set_tuner_gain(dev, gain);
        rtlsdr_set_agc_mode(dev, 0);
        rtlsdr_reset_buffer(dev);

        fprintf(stderr, "SDR: freq=%u Hz, rate=%u, gain=%.1f dB\n",
                ADSB_FREQ, SAMPLE_RATE, gain / 10.0f);
    } else {
        fprintf(stderr, "TEST MODE: generating synthetic ADS-B messages\n");
    }

    int frame_count = 0;
    int64_t last_report = now_ms();

    /* ── Main loop ── */
    while (g_running) {
        int n_read = 0;

        if (test_mode) {
            /* Generate synthetic data */
            memset(raw_buf, 128, CAPTURE_BYTES);  /* baseline silence */

            /* Inject test messages at known offsets */
            uint8_t test_msg[14];

            /* Aircraft 1: identification (callsign) */
            build_test_msg(test_msg, 0x4840D6, 4, "UAL1532 ");
            inject_test_preamble(raw_buf, 1000, test_msg);

            /* Aircraft 1: position (even frame) */
            build_test_msg(test_msg, 0x4840D6, 11, NULL);
            inject_test_preamble(raw_buf, 2000, test_msg);

            /* Aircraft 2: identification */
            build_test_msg(test_msg, 0xA12BC3, 2, "DAL872  ");
            inject_test_preamble(raw_buf, 4000, test_msg);

            n_read = CAPTURE_BYTES;

            /* Slow down test mode to ~real-time */
#ifdef _WIN32
            Sleep(131);
#else
            usleep(131000);
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

        /* Convert raw uint8 IQ → magnitude via LUT */
        for (int i = 0; i < n_iq; i++) {
            mag[i] = g_mag_lut[raw_buf[2 * i] * 256 + raw_buf[2 * i + 1]];
        }

        /* Detect preambles and decode messages */
        detect_and_decode(mag, n_iq);

        /* Age out stale aircraft */
        int64_t now = now_ms();
        age_aircraft(now);

        frame_count++;

        /* Emit spectrum (every SPECTRUM_INTERVAL blocks) */
        if (frame_count % SPECTRUM_INTERVAL == 0) {
            compute_spectrum(raw_buf, n_read, ADSB_FREQ, spectrum);
            write_spectrum_frame(spectrum, SPECTRUM_BINS, ADSB_FREQ);
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
    free(mag);

    return 0;
}
