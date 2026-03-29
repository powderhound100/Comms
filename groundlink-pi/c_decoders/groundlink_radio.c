/*
 * groundlink_radio.c — C SDR demodulator + spectrum tool for GROUNDLINK.
 *
 * Reads IQ from RTL-SDR, decimates THEN demodulates (10x less work than
 * the Python scipy path), computes FFT spectrum, and outputs binary frames
 * on stdout for the Python WebSocket server to forward to the browser.
 *
 * Build:  build_radio.bat  (MSVC cl.exe + rtlsdr.lib)
 * Usage:  groundlink_radio.exe --freq 94900000 --mode wfm --gain 400
 *
 * Output protocol (stdout, binary):
 *   Audio frame:    'A' (1B) + length (uint32 LE) + sample_rate (uint32 LE) + int16[] PCM
 *   Spectrum frame: 'S' (1B) + length (uint32 LE) + center_freq (uint32 LE) + float[] dBFS
 *   Gain frame:     'G' (1B) + length (uint32 LE) + gain_tenths (int32 LE)
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

#include "rtlsdr.h"

/* ── Constants ─────────────────────────────────────────────────── */

#define CAPTURE_BYTES   524288          /* 262144 IQ pairs (~109ms at 2.4M) */
#define CAPTURE_IQ      (CAPTURE_BYTES / 2)
#define SAMPLE_RATE     2400000
#define FFT_SIZE        1024
#define SPECTRUM_BINS   256             /* FFT_SIZE / 4 */
#define PI_F            3.14159265358979f
#define PI_4            0.78539816339745f

/* ── Modes ─────────────────────────────────────────────────────── */

enum demod_mode { MODE_WFM, MODE_NFM, MODE_AM, MODE_DISC };

/* ── Globals ───────────────────────────────────────────────────── */

static volatile int g_running = 1;

static void sighandler(int sig) {
    (void)sig;
    g_running = 0;
}

/* ── Fast atan2 approximation (~5x faster than atan2f) ─────── */

static float fast_atan2f(float y, float x) {
    float abs_y = fabsf(y) + 1e-10f;
    float r, angle;
    if (x >= 0.0f) {
        r = (x - abs_y) / (x + abs_y);
        angle = PI_4;
    } else {
        r = (x + abs_y) / (abs_y - x);
        angle = 3.0f * PI_4;
    }
    angle += (0.1963f * r * r - 0.9817f) * r;
    /* Clamp — polynomial can overshoot ±PI near y≈0, x<0 boundary */
    if (angle > PI_F) angle = PI_F;
    return (y < 0.0f) ? -angle : angle;
}

/* ── Simple radix-2 FFT (in-place, 1024-point) ────────────── */

static void fft_radix2(float *re, float *im, int n) {
    int i, j, k, m, step;
    float tr, ti, wr, wi, theta;

    /* Bit-reversal permutation */
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

    /* Butterfly stages */
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

/* ── Hann window ───────────────────────────────────────────── */

static float g_hann[FFT_SIZE];

static void init_hann(void) {
    for (int i = 0; i < FFT_SIZE; i++) {
        g_hann[i] = 0.5f * (1.0f - cosf(2.0f * PI_F * i / (FFT_SIZE - 1)));
    }
}

/* ── Compute spectrum: Hann → FFT → dBFS, 256 output bins ── */

static void compute_spectrum(const float *iq_i, const float *iq_q,
                             int n_iq, uint32_t center_freq,
                             float *out_bins) {
    float re[FFT_SIZE], im_buf[FFT_SIZE];
    int i;

    /* Take FFT_SIZE samples from the middle of the capture */
    int offset = (n_iq - FFT_SIZE) / 2;
    if (offset < 0) offset = 0;

    for (i = 0; i < FFT_SIZE; i++) {
        re[i] = iq_i[offset + i] * g_hann[i];
        im_buf[i] = iq_q[offset + i] * g_hann[i];
    }

    fft_radix2(re, im_buf, FFT_SIZE);

    /* Magnitude² → dBFS, normalize by N², reorder DC-center, downsample 4x */
    float mag2[FFT_SIZE];
    float norm = 1.0f / ((float)FFT_SIZE * (float)FFT_SIZE);
    for (i = 0; i < FFT_SIZE; i++) {
        mag2[i] = (re[i] * re[i] + im_buf[i] * im_buf[i]) * norm;
    }

    /* FFT output: [0..N/2-1] = DC to +fs/2,  [N/2..N-1] = -fs/2 to DC
       Reorder to: [-fs/2 ... 0 ... +fs/2]  i.e. start at bin N/2 */
    for (i = 0; i < SPECTRUM_BINS; i++) {
        /* Average 4 consecutive bins */
        int src = ((i * 4) + FFT_SIZE / 2) % FFT_SIZE;
        float sum = 0.0f;
        for (int j = 0; j < 4; j++) {
            sum += mag2[(src + j) % FFT_SIZE];
        }
        sum /= 4.0f;
        out_bins[i] = 10.0f * log10f(sum + 1e-12f);
    }
}

/* ── FIR low-pass filter coefficients (64-tap, normalized sinc) ── */

#define FIR_TAPS 64

static void make_lowpass_fir(float *h, int taps, float cutoff) {
    /* cutoff: fraction of sample rate (0..0.5) */
    float sum = 0.0f;
    int M = taps - 1;
    for (int i = 0; i < taps; i++) {
        float n = (float)i - (float)M / 2.0f;
        if (fabsf(n) < 1e-6f) {
            h[i] = 2.0f * cutoff;
        } else {
            h[i] = sinf(2.0f * PI_F * cutoff * n) / (PI_F * n);
        }
        /* Hamming window */
        h[i] *= 0.54f - 0.46f * cosf(2.0f * PI_F * i / M);
        sum += h[i];
    }
    /* Normalize */
    for (int i = 0; i < taps; i++) h[i] /= sum;
}

/* ── Decimate complex IQ: FIR low-pass + downsample ────────── */
/* hist_i/hist_q: tail of previous block (FIR_TAPS samples) for continuity.
   Pass NULL on first call; the function uses zeros for missing history. */

static int decimate_iq(const float *in_i, const float *in_q, int n_in,
                       float *out_i, float *out_q,
                       const float *fir, int fir_len, int factor,
                       const float *hist_i, const float *hist_q,
                       int *phase) {
    int n_out = 0;
    int start = phase ? *phase : 0;
    int i = start;
    for (; i < n_in; i += factor) {
        if (n_out >= CAPTURE_IQ) break;  /* buffer safety cap */
        float si = 0.0f, sq = 0.0f;
        for (int t = 0; t < fir_len; t++) {
            int idx = i - t;
            if (idx >= 0) {
                si += fir[t] * in_i[idx];
                sq += fir[t] * in_q[idx];
            } else if (hist_i) {
                /* Reach into previous block's tail */
                int hi = fir_len + idx;  /* fir_len - t + i */
                if (hi >= 0 && hi < fir_len) {
                    si += fir[t] * hist_i[hi];
                    sq += fir[t] * hist_q[hi];
                }
            }
        }
        out_i[n_out] = si;
        out_q[n_out] = sq;
        n_out++;
    }
    /* Save phase: how far past n_in the next sample would fall */
    if (phase) *phase = i - n_in;
    return n_out;
}

/* ── Decimate real signal: FIR low-pass + downsample ───────── */

static int decimate_real(const float *in, int n_in,
                         float *out,
                         const float *fir, int fir_len, int factor,
                         const float *hist,
                         int *phase) {
    int n_out = 0;
    int start = phase ? *phase : 0;
    int i = start;
    for (; i < n_in; i += factor) {
        if (n_out >= CAPTURE_IQ) break;  /* buffer safety cap */
        float s = 0.0f;
        for (int t = 0; t < fir_len; t++) {
            int idx = i - t;
            if (idx >= 0) {
                s += fir[t] * in[idx];
            } else if (hist) {
                int hi = fir_len + idx;
                if (hi >= 0 && hi < fir_len) {
                    s += fir[t] * hist[hi];
                }
            }
        }
        out[n_out++] = s;
    }
    if (phase) *phase = i - n_in;
    return n_out;
}

/* ── De-emphasis IIR: y[n] = y[n-1] + alpha*(x[n] - y[n-1]) ── */

static void deemphasis(float *audio, int n, float alpha, float *state) {
    float prev = *state;
    for (int i = 0; i < n; i++) {
        prev = prev + alpha * (audio[i] - prev);
        audio[i] = prev;
    }
    *state = prev;
}

/* DC-blocking filter: y[n] = x[n] - x[n-1] + R * y[n-1]
   R ≈ 1 - 2π·fc/fs,  fc = cutoff Hz, fs = sample rate.
   For fc=5 Hz @ 48kHz → R ≈ 0.99935; fc=5 Hz @ 16kHz → R ≈ 0.998 */
static void dc_block(float *audio, int n, float R, float *x_prev, float *y_prev) {
    float xp = *x_prev, yp = *y_prev;
    for (int i = 0; i < n; i++) {
        float x = audio[i];
        yp = x - xp + R * yp;
        xp = x;
        audio[i] = yp;
    }
    *x_prev = xp;
    *y_prev = yp;
}

/* ── Write a binary frame to stdout ──────────────────────────── */

static void write_audio_frame(const int16_t *pcm, int n_samples,
                              uint32_t sample_rate) {
    uint8_t tag = 'A';
    uint32_t payload_len = 4 + (uint32_t)(n_samples * sizeof(int16_t));
    fwrite(&tag, 1, 1, stdout);
    fwrite(&payload_len, 4, 1, stdout);
    fwrite(&sample_rate, 4, 1, stdout);
    fwrite(pcm, sizeof(int16_t), n_samples, stdout);
    fflush(stdout);
}

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

static void write_gain_frame(int gain_tenths) {
    uint8_t tag = 'G';
    uint32_t payload_len = 4;
    int32_t g = (int32_t)gain_tenths;
    fwrite(&tag, 1, 1, stdout);
    fwrite(&payload_len, 4, 1, stdout);
    fwrite(&g, 4, 1, stdout);
    fflush(stdout);
}

/* ── Parse command line ──────────────────────────────────────── */

static char g_device_serial[64] = "";
static int  g_device_index = 0;
static int  g_dc_offset = 200000;   /* Hz — tune off-center to avoid DC spike */
static int  g_auto_gain = 0;        /* toggleable hardware AGC */

static int parse_args(int argc, char **argv,
                      uint32_t *freq, enum demod_mode *mode,
                      int *gain, uint32_t *rate) {
    *freq = 94900000;
    *mode = MODE_WFM;
    *gain = 400;       /* 40.0 dB */
    *rate = SAMPLE_RATE;
    g_device_serial[0] = '\0';

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--freq") == 0 && i + 1 < argc) {
            *freq = (uint32_t)atol(argv[++i]);
        } else if (strcmp(argv[i], "--mode") == 0 && i + 1 < argc) {
            i++;
            if (strcmp(argv[i], "wfm") == 0) *mode = MODE_WFM;
            else if (strcmp(argv[i], "nfm") == 0) *mode = MODE_NFM;
            else if (strcmp(argv[i], "am") == 0) *mode = MODE_AM;
            else if (strcmp(argv[i], "disc") == 0) *mode = MODE_DISC;
            else {
                fprintf(stderr, "Unknown mode: %s\n", argv[i]);
                return -1;
            }
        } else if (strcmp(argv[i], "--gain") == 0 && i + 1 < argc) {
            *gain = atoi(argv[++i]);
        } else if (strcmp(argv[i], "--rate") == 0 && i + 1 < argc) {
            *rate = (uint32_t)atol(argv[++i]);
        } else if (strcmp(argv[i], "--dc-offset") == 0 && i + 1 < argc) {
            g_dc_offset = atoi(argv[++i]);
        } else if (strcmp(argv[i], "--auto-gain") == 0) {
            g_auto_gain = 1;
        } else if (strcmp(argv[i], "--device") == 0 && i + 1 < argc) {
            g_device_index = atoi(argv[++i]);
        } else if (strcmp(argv[i], "--device-serial") == 0 && i + 1 < argc) {
            strncpy(g_device_serial, argv[++i], sizeof(g_device_serial) - 1);
        } else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            fprintf(stderr,
                "groundlink_radio — C SDR demodulator + spectrum tool\n\n"
                "Usage: groundlink_radio [options]\n"
                "  --freq HZ          Center frequency (default: 94900000)\n"
                "  --mode MODE        wfm, nfm, am, disc (default: wfm)\n"
                "  --gain TENTH       Gain in tenths of dB (default: 400 = 40.0 dB)\n"
                "  --rate HZ          Sample rate (default: 2400000)\n"
                "  --dc-offset HZ     DC offset tuning (default: 200000 = 200kHz)\n"
                "  --auto-gain        Enable hardware AGC (reduce gain on clipping)\n"
                "  --device N         RTL-SDR device index (default: 0)\n"
                "  --device-serial SN RTL-SDR device serial (overrides --device)\n");
            return -1;
        }
    }
    return 0;
}

/* ── Main ────────────────────────────────────────────────────── */

int main(int argc, char **argv) {
    uint32_t freq, rate;
    enum demod_mode mode;
    int gain;

    if (parse_args(argc, argv, &freq, &mode, &gain, &rate) != 0)
        return 1;

    /* Set stdout to binary mode (Windows) */
#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
#endif

    signal(SIGINT, sighandler);
    signal(SIGTERM, sighandler);

    init_hann();

    /* ── Build FIR filters for each decimation stage ── */
    float fir_5[FIR_TAPS], fir_2[FIR_TAPS], fir_10[FIR_TAPS];
    make_lowpass_fir(fir_5,  FIR_TAPS, 0.5f / 5.0f);   /* cutoff for /5  */
    make_lowpass_fir(fir_2,  FIR_TAPS, 0.5f / 2.0f);   /* cutoff for /2  */
    make_lowpass_fir(fir_10, FIR_TAPS, 0.5f / 10.0f);  /* cutoff for /10 */

    /* Audio FIR for final decimation */
    float fir_audio5[FIR_TAPS], fir_audio3[FIR_TAPS], fir_audio6[FIR_TAPS];
    make_lowpass_fir(fir_audio5, FIR_TAPS, 0.5f / 5.0f);
    make_lowpass_fir(fir_audio3, FIR_TAPS, 0.5f / 3.0f);
    make_lowpass_fir(fir_audio6, FIR_TAPS, 0.5f / 6.0f);

    /* ── Open RTL-SDR ── */
    rtlsdr_dev_t *dev = NULL;
    uint32_t dev_count = rtlsdr_get_device_count();
    if (dev_count == 0) {
        fprintf(stderr, "ERROR: No RTL-SDR devices found\n");
        return 1;
    }
    fprintf(stderr, "Found %u RTL-SDR device(s)\n", dev_count);

    /* Resolve device serial to index */
    int dev_idx = g_device_index;
    if (g_device_serial[0] != '\0') {
        int idx = rtlsdr_get_index_by_serial(g_device_serial);
        if (idx < 0) {
            fprintf(stderr, "ERROR: Device serial '%s' not found\n", g_device_serial);
            return 1;
        }
        dev_idx = idx;
        fprintf(stderr, "Found device serial '%s' at index %d\n", g_device_serial, dev_idx);
    }

    if (rtlsdr_open(&dev, (uint32_t)dev_idx) != 0) {
        fprintf(stderr, "ERROR: Failed to open RTL-SDR device %d\n", dev_idx);
        return 1;
    }

    /* DC offset tuning: tune SDR off-center to avoid DC spike */
    uint32_t actual_freq = freq + (uint32_t)g_dc_offset;
    rtlsdr_set_sample_rate(dev, rate);
    rtlsdr_set_center_freq(dev, actual_freq);
    rtlsdr_set_tuner_gain_mode(dev, 1);   /* manual gain */
    rtlsdr_set_tuner_gain(dev, gain);
    rtlsdr_set_agc_mode(dev, 0);
    rtlsdr_reset_buffer(dev);

    /* Build gain step table for hardware AGC */
    int gain_table[64];
    int n_gains = rtlsdr_get_tuner_gains(dev, NULL);
    if (n_gains > 64) n_gains = 64;
    if (n_gains > 0) rtlsdr_get_tuner_gains(dev, gain_table);
    int gain_idx = 0;
    for (int i = 0; i < n_gains; i++) {
        if (gain_table[i] == gain) { gain_idx = i; break; }
    }
    int gain_reduced = 0;  /* flag: AGC has already stepped down */

    fprintf(stderr, "SDR configured: freq=%u Hz (tuned %+dHz → %u), rate=%u, gain=%.1f dB, mode=%s%s\n",
            freq, g_dc_offset, actual_freq, rate, gain / 10.0f,
            mode == MODE_WFM ? "WFM" : mode == MODE_NFM ? "NFM" :
            mode == MODE_AM ? "AM" : "DISC",
            g_auto_gain ? ", auto-gain ON" : "");

    /* ── Allocate buffers ── */
    uint8_t *raw_buf = (uint8_t *)malloc(CAPTURE_BYTES);
    float *iq_i = (float *)malloc(CAPTURE_IQ * sizeof(float));
    float *iq_q = (float *)malloc(CAPTURE_IQ * sizeof(float));

    /* Decimation intermediate buffers (generous sizing) */
    float *dec1_i = (float *)malloc(CAPTURE_IQ * sizeof(float));
    float *dec1_q = (float *)malloc(CAPTURE_IQ * sizeof(float));
    float *dec2_i = (float *)malloc(CAPTURE_IQ * sizeof(float));
    float *dec2_q = (float *)malloc(CAPTURE_IQ * sizeof(float));

    /* Audio buffer */
    float *audio = (float *)malloc(CAPTURE_IQ * sizeof(float));
    float *audio_dec = (float *)malloc(CAPTURE_IQ * sizeof(float));
    int16_t *pcm = (int16_t *)malloc(CAPTURE_IQ * sizeof(int16_t));

    /* Spectrum output */
    float spectrum[SPECTRUM_BINS];

    if (!raw_buf || !iq_i || !iq_q || !dec1_i || !dec1_q ||
        !dec2_i || !dec2_q || !audio || !audio_dec || !pcm) {
        fprintf(stderr, "ERROR: Memory allocation failed\n");
        rtlsdr_close(dev);
        return 1;
    }

    /* De-emphasis state */
    float deemph_state = 0.0f;

    /* FM demod prev sample */
    float prev_i = 0.0f, prev_q = 0.0f;

    /* AM: running DC removal and AGC state (persist across blocks) */
    float am_dc = 0.0f;        /* IIR DC estimator */
    float agc_peak = (mode == MODE_WFM) ? 0.5f : 0.01f;  /* WFM: mid-range avoids initial transient; AM/NFM: low start for weak signals */

    /* Audio DC block state (post-demod) */
    float dcb_x_prev = 0.0f, dcb_y_prev = 0.0f;

    /* IQ DC block state (pre-demod, separate I/Q channels) */
    float iq_dcb_ix = 0.0f, iq_dcb_iy = 0.0f;
    float iq_dcb_qx = 0.0f, iq_dcb_qy = 0.0f;

    /* NCO mixer state for DC offset tuning */
    float mixer_phase = 0.0f;
    float phase_inc = 2.0f * PI_F * (float)g_dc_offset / (float)rate;
    float rot_cos = cosf(phase_inc);
    float rot_sin = sinf(phase_inc);

    /* Squelch state (AM/NFM) */
    float noise_floor = 0.05f; /* IIR noise floor estimator */
    float squelch_gate = 0.0f; /* 0.0 = muted, 1.0 = open */

    /* FIR filter history buffers — tail of previous block for continuity */
    float hist_iq_i[FIR_TAPS] = {0}, hist_iq_q[FIR_TAPS] = {0};  /* stage 1 (raw IQ) */
    float hist_audio[FIR_TAPS] = {0};                              /* audio */

    /* Intermediate decimation history (NFM/AM/DISC stages 2 & 3) */
    float hist_stg2_i[FIR_TAPS] = {0}, hist_stg2_q[FIR_TAPS] = {0};
    float hist_stg3_i[FIR_TAPS] = {0}, hist_stg3_q[FIR_TAPS] = {0};
    int stg2_phase = 0, stg3_phase = 0;

    /* Decimation phase — carry remainder across blocks for uniform sample spacing */
    int iq_dec_phase = 0;
    int audio_dec_phase = 0;

    int frame_count = 0;

    /* ── Main loop ── */
    while (g_running) {
        int n_read = 0;
        int r = rtlsdr_read_sync(dev, raw_buf, CAPTURE_BYTES, &n_read);
        if (r != 0 || n_read != CAPTURE_BYTES) {
            fprintf(stderr, "WARNING: read_sync returned %d, got %d bytes\n", r, n_read);
            if (r != 0) break;
            continue;
        }

        /* Convert uint8 IQ → float [-1, 1] with ADC clipping detection */
        int n_iq = n_read / 2;
        int clip_count = 0;
        for (int i = 0; i < n_iq; i++) {
            uint8_t ri = raw_buf[2 * i];
            uint8_t rq = raw_buf[2 * i + 1];
            if (ri == 0 || ri == 255) clip_count++;
            if (rq == 0 || rq == 255) clip_count++;
            iq_i[i] = (ri - 127.5f) / 128.0f;
            iq_q[i] = (rq - 127.5f) / 128.0f;
        }

        /* Hardware AGC: step gain down once if clipping detected */
        if (g_auto_gain && !gain_reduced && clip_count > n_iq / 50) {
            /* >2% clipped — step down one notch */
            if (gain_idx > 0 && n_gains > 0) {
                gain_idx--;
                rtlsdr_set_tuner_gain(dev, gain_table[gain_idx]);
                fprintf(stderr, "AGC: clipping %d/%d (%.1f%%) — gain → %.1f dB\n",
                        clip_count, n_iq * 2,
                        100.0f * clip_count / (n_iq * 2),
                        gain_table[gain_idx] / 10.0f);
                write_gain_frame(gain_table[gain_idx]);
                gain_reduced = 1;
            }
        } else if (!g_auto_gain && clip_count > n_iq / 50) {
            fprintf(stderr, "WARNING: ADC clipping: %d/%d samples (%.1f%%) — reduce gain\n",
                    clip_count, n_iq * 2, 100.0f * clip_count / (n_iq * 2));
        }

        /* NCO mixer: shift IQ back from DC-offset tuning */
        if (g_dc_offset != 0) {
            float m_cos = cosf(mixer_phase);
            float m_sin = sinf(mixer_phase);
            for (int i = 0; i < n_iq; i++) {
                float ii = iq_i[i], qq = iq_q[i];
                iq_i[i] = ii * m_cos - qq * m_sin;
                iq_q[i] = ii * m_sin + qq * m_cos;
                float nc = m_cos * rot_cos - m_sin * rot_sin;
                float ns = m_cos * rot_sin + m_sin * rot_cos;
                m_cos = nc;
                m_sin = ns;
                /* Renormalize every 1024 samples to prevent amplitude drift */
                if ((i & 1023) == 1023) {
                    float inv_mag = 1.0f / sqrtf(m_cos * m_cos + m_sin * m_sin);
                    m_cos *= inv_mag;
                    m_sin *= inv_mag;
                }
            }
            mixer_phase = atan2f(m_sin, m_cos);
        }

        /* IQ DC block: remove residual DC from ADC/tuner imbalance */
        {
            float R_iq = 1.0f - (2.0f * PI_F * 5.0f / (float)rate);
            dc_block(iq_i, n_iq, R_iq, &iq_dcb_ix, &iq_dcb_iy);
            dc_block(iq_q, n_iq, R_iq, &iq_dcb_qx, &iq_dcb_qy);
        }

        /* ── Spectrum (every 3rd frame) ── */
        frame_count++;
        if (frame_count % 3 == 0) {
            compute_spectrum(iq_i, iq_q, n_iq, freq, spectrum);
            write_spectrum_frame(spectrum, SPECTRUM_BINS, freq);
        }

        /* ── Decimation + Demodulation ── */
        int n_audio = 0;
        uint32_t audio_rate = 48000;

        if (mode == MODE_WFM) {
            /*
             * WFM: 2.4M → /10 → 240k IQ, then FM demod, then /5 → 48k audio
             */
            int n_dec = decimate_iq(iq_i, iq_q, n_iq,
                                    dec1_i, dec1_q,
                                    fir_10, FIR_TAPS, 10,
                                    hist_iq_i, hist_iq_q,
                                    &iq_dec_phase);

            /* Save IQ history for next block */
            if (n_iq >= FIR_TAPS) {
                memcpy(hist_iq_i, iq_i + n_iq - FIR_TAPS, FIR_TAPS * sizeof(float));
                memcpy(hist_iq_q, iq_q + n_iq - FIR_TAPS, FIR_TAPS * sizeof(float));
            }

            /* FM demod on decimated IQ */
            for (int i = 0; i < n_dec; i++) {
                float cr = dec1_i[i] * prev_i + dec1_q[i] * prev_q;
                float cj = dec1_q[i] * prev_i - dec1_i[i] * prev_q;
                audio[i] = fast_atan2f(cj, cr);
                prev_i = dec1_i[i];
                prev_q = dec1_q[i];
            }

            /* Decimate audio: 240k → /5 → 48k */
            n_audio = decimate_real(audio, n_dec,
                                    audio_dec,
                                    fir_audio5, FIR_TAPS, 5,
                                    hist_audio,
                                    &audio_dec_phase);
            audio_rate = 48000;

            /* Save audio history */
            if (n_dec >= FIR_TAPS) {
                memcpy(hist_audio, audio + n_dec - FIR_TAPS, FIR_TAPS * sizeof(float));
            }

            /* De-emphasis: 75 μs (North America WFM) */
            float alpha = 1.0f - expf(-1.0f / (48000.0f * 75e-6f));
            deemphasis(audio_dec, n_audio, alpha, &deemph_state);

        } else if (mode == MODE_NFM) {
            /*
             * NFM: 2.4M → /5 → 480k → /5 → 96k → /2 → 48k IQ,
             *      then FM demod, then /3 → 16k audio
             */
            int n1 = decimate_iq(iq_i, iq_q, n_iq,
                                 dec1_i, dec1_q,
                                 fir_5, FIR_TAPS, 5,
                                 hist_iq_i, hist_iq_q,
                                 &iq_dec_phase);

            /* Save IQ history (from raw input) */
            if (n_iq >= FIR_TAPS) {
                memcpy(hist_iq_i, iq_i + n_iq - FIR_TAPS, FIR_TAPS * sizeof(float));
                memcpy(hist_iq_q, iq_q + n_iq - FIR_TAPS, FIR_TAPS * sizeof(float));
            }

            int n2 = decimate_iq(dec1_i, dec1_q, n1,
                                 dec2_i, dec2_q,
                                 fir_5, FIR_TAPS, 5,
                                 hist_stg2_i, hist_stg2_q,
                                 &stg2_phase);
            if (n1 >= FIR_TAPS) {
                memcpy(hist_stg2_i, dec1_i + n1 - FIR_TAPS, FIR_TAPS * sizeof(float));
                memcpy(hist_stg2_q, dec1_q + n1 - FIR_TAPS, FIR_TAPS * sizeof(float));
            }

            int n3 = decimate_iq(dec2_i, dec2_q, n2,
                                 dec1_i, dec1_q,
                                 fir_2, FIR_TAPS, 2,
                                 hist_stg3_i, hist_stg3_q,
                                 &stg3_phase);
            if (n2 >= FIR_TAPS) {
                memcpy(hist_stg3_i, dec2_i + n2 - FIR_TAPS, FIR_TAPS * sizeof(float));
                memcpy(hist_stg3_q, dec2_q + n2 - FIR_TAPS, FIR_TAPS * sizeof(float));
            }

            /* FM demod on 48k IQ */
            for (int i = 0; i < n3; i++) {
                float cr = dec1_i[i] * prev_i + dec1_q[i] * prev_q;
                float cj = dec1_q[i] * prev_i - dec1_i[i] * prev_q;
                audio[i] = fast_atan2f(cj, cr);
                prev_i = dec1_i[i];
                prev_q = dec1_q[i];
            }

            /* Decimate audio: 48k → /3 → 16k */
            n_audio = decimate_real(audio, n3,
                                    audio_dec,
                                    fir_audio3, FIR_TAPS, 3,
                                    hist_audio,
                                    &audio_dec_phase);
            audio_rate = 16000;

            if (n3 >= FIR_TAPS) {
                memcpy(hist_audio, audio + n3 - FIR_TAPS, FIR_TAPS * sizeof(float));
            }

            /* De-emphasis: 50 μs (NFM) */
            float alpha = 1.0f - expf(-1.0f / (16000.0f * 50e-6f));
            deemphasis(audio_dec, n_audio, alpha, &deemph_state);

        } else if (mode == MODE_DISC) {
            /*
             * DISC: 2.4M → /5 → 480k → /5 → 96k → /2 → 48k IQ,
             *       then FM discriminator at 48k — NO audio decimation,
             *       NO de-emphasis (digital symbols need raw output)
             */
            int n1 = decimate_iq(iq_i, iq_q, n_iq,
                                 dec1_i, dec1_q,
                                 fir_5, FIR_TAPS, 5,
                                 hist_iq_i, hist_iq_q,
                                 &iq_dec_phase);

            if (n_iq >= FIR_TAPS) {
                memcpy(hist_iq_i, iq_i + n_iq - FIR_TAPS, FIR_TAPS * sizeof(float));
                memcpy(hist_iq_q, iq_q + n_iq - FIR_TAPS, FIR_TAPS * sizeof(float));
            }

            int n2 = decimate_iq(dec1_i, dec1_q, n1,
                                 dec2_i, dec2_q,
                                 fir_5, FIR_TAPS, 5,
                                 hist_stg2_i, hist_stg2_q,
                                 &stg2_phase);
            if (n1 >= FIR_TAPS) {
                memcpy(hist_stg2_i, dec1_i + n1 - FIR_TAPS, FIR_TAPS * sizeof(float));
                memcpy(hist_stg2_q, dec1_q + n1 - FIR_TAPS, FIR_TAPS * sizeof(float));
            }

            int n3 = decimate_iq(dec2_i, dec2_q, n2,
                                 dec1_i, dec1_q,
                                 fir_2, FIR_TAPS, 2,
                                 hist_stg3_i, hist_stg3_q,
                                 &stg3_phase);
            if (n2 >= FIR_TAPS) {
                memcpy(hist_stg3_i, dec2_i + n2 - FIR_TAPS, FIR_TAPS * sizeof(float));
                memcpy(hist_stg3_q, dec2_q + n2 - FIR_TAPS, FIR_TAPS * sizeof(float));
            }

            /* FM discriminator on 48k IQ — output stays at 48k */
            for (int i = 0; i < n3; i++) {
                float cr = dec1_i[i] * prev_i + dec1_q[i] * prev_q;
                float cj = dec1_q[i] * prev_i - dec1_i[i] * prev_q;
                audio_dec[i] = fast_atan2f(cj, cr);
                prev_i = dec1_i[i];
                prev_q = dec1_q[i];
            }

            n_audio = n3;
            audio_rate = 48000;

        } else {  /* MODE_AM */
            /*
             * AM: 2.4M → /5 → 480k → /5 → 96k → /2 → 48k IQ,
             *     then envelope detection, then /3 → 16k audio
             */
            int n1 = decimate_iq(iq_i, iq_q, n_iq,
                                 dec1_i, dec1_q,
                                 fir_5, FIR_TAPS, 5,
                                 hist_iq_i, hist_iq_q,
                                 &iq_dec_phase);

            if (n_iq >= FIR_TAPS) {
                memcpy(hist_iq_i, iq_i + n_iq - FIR_TAPS, FIR_TAPS * sizeof(float));
                memcpy(hist_iq_q, iq_q + n_iq - FIR_TAPS, FIR_TAPS * sizeof(float));
            }

            int n2 = decimate_iq(dec1_i, dec1_q, n1,
                                 dec2_i, dec2_q,
                                 fir_5, FIR_TAPS, 5,
                                 hist_stg2_i, hist_stg2_q,
                                 &stg2_phase);
            if (n1 >= FIR_TAPS) {
                memcpy(hist_stg2_i, dec1_i + n1 - FIR_TAPS, FIR_TAPS * sizeof(float));
                memcpy(hist_stg2_q, dec1_q + n1 - FIR_TAPS, FIR_TAPS * sizeof(float));
            }

            int n3 = decimate_iq(dec2_i, dec2_q, n2,
                                 dec1_i, dec1_q,
                                 fir_2, FIR_TAPS, 2,
                                 hist_stg3_i, hist_stg3_q,
                                 &stg3_phase);
            if (n2 >= FIR_TAPS) {
                memcpy(hist_stg3_i, dec2_i + n2 - FIR_TAPS, FIR_TAPS * sizeof(float));
                memcpy(hist_stg3_q, dec2_q + n2 - FIR_TAPS, FIR_TAPS * sizeof(float));
            }

            /* AM envelope detection with IIR DC removal (no block boundary clicks) */
            float dc_alpha = 1.0f - expf(-2.0f * PI_F * 20.0f / 48000.0f);
            for (int i = 0; i < n3; i++) {
                float mag = sqrtf(dec1_i[i] * dec1_i[i] + dec1_q[i] * dec1_q[i]);
                am_dc += dc_alpha * (mag - am_dc);
                audio[i] = mag - am_dc;
            }

            /* Decimate audio: 48k → /3 → 16k */
            n_audio = decimate_real(audio, n3,
                                    audio_dec,
                                    fir_audio3, FIR_TAPS, 3,
                                    hist_audio,
                                    &audio_dec_phase);
            audio_rate = 16000;

            if (n3 >= FIR_TAPS) {
                memcpy(hist_audio, audio + n3 - FIR_TAPS, FIR_TAPS * sizeof(float));
            }
        }

        /* DC block: remove sub-5 Hz drift / popping (skip DISC — raw symbols) */
        if (mode != MODE_DISC) {
            float R = 1.0f - (2.0f * PI_F * 5.0f / (float)audio_rate);
            dc_block(audio_dec, n_audio, R, &dcb_x_prev, &dcb_y_prev);
        }

        /* ── Normalize + convert to int16 PCM ── */
        if (mode == MODE_DISC) {
            /* DISC: fixed-gain scaling, no AGC/squelch.
             * fast_atan2f output is [-PI, PI], scale to ~80% of int16 range. */
            float disc_scale = 0.8f * 32767.0f / PI_F;
            for (int i = 0; i < n_audio; i++) {
                float s = audio_dec[i] * disc_scale;
                pcm[i] = (int16_t)fmaxf(-32768.0f, fminf(32767.0f, s));
            }
        } else {

        float block_peak = 0.0f;
        for (int i = 0; i < n_audio; i++) {
            float a = fabsf(audio_dec[i]);
            if (a > block_peak) block_peak = a;
        }

        float scale;
        if (mode == MODE_WFM) {
            /* WFM: slow AGC — no per-block peak normalization.
             * FM broadcast has pre-processed audio, so levels are stable.
             * Slow attack avoids reacting to every syllable; very slow release
             * holds gain during brief quiet passages (like a real FM receiver). */
            if (block_peak > agc_peak) {
                agc_peak += 0.1f * (block_peak - agc_peak);    /* attack: ~10 blocks (~1s) */
            } else {
                agc_peak += 0.002f * (block_peak - agc_peak);  /* release: ~500 blocks (~55s) */
            }
            scale = (agc_peak > 1e-6f) ? (0.8f * 32767.0f / agc_peak) : 32767.0f;
            squelch_gate = 1.0f;
        } else {
            /* AM/NFM: faster AGC + squelch */
            if (block_peak > agc_peak) {
                agc_peak += 0.3f * (block_peak - agc_peak);
            } else {
                agc_peak += 0.005f * (block_peak - agc_peak);
            }
            scale = (agc_peak > 1e-6f) ? (0.6f * 32767.0f / agc_peak) : 32767.0f;

            /* ── Squelch: mute when signal is near noise floor ── */
            if (block_peak < noise_floor) {
                noise_floor += 0.1f * (block_peak - noise_floor);   /* drop fast */
            } else {
                noise_floor += 0.001f * (block_peak - noise_floor); /* rise very slow */
            }

            float squelch_ratio = (noise_floor > 1e-8f) ? (block_peak / noise_floor) : 1.0f;
            if (squelch_ratio > 3.0f) {
                squelch_gate += 0.4f * (1.0f - squelch_gate);
            } else {
                squelch_gate *= 0.85f;
            }
            if (squelch_gate < 0.01f) squelch_gate = 0.0f;
        }

        for (int i = 0; i < n_audio; i++) {
            float s = audio_dec[i] * scale * squelch_gate;
            if (s > 32767.0f) s = 32767.0f;
            if (s < -32768.0f) s = -32768.0f;
            pcm[i] = (int16_t)s;
        }

        } /* end !MODE_DISC */

        /* ── Output audio frame ── */
        if (n_audio > 0) {
            write_audio_frame(pcm, n_audio, audio_rate);
        }
    }

    /* ── Cleanup ── */
    fprintf(stderr, "Shutting down...\n");
    rtlsdr_close(dev);
    free(raw_buf);
    free(iq_i);
    free(iq_q);
    free(dec1_i);
    free(dec1_q);
    free(dec2_i);
    free(dec2_q);
    free(audio);
    free(audio_dec);
    free(pcm);

    return 0;
}
