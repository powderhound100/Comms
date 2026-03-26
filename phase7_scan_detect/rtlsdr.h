/*
 * rtlsdr.h — Minimal librtlsdr API header for groundlink_radio.
 *
 * Declares only the functions we use. Links against rtlsdr.dll/.lib
 * from the official rtl-sdr distribution.
 */

#ifndef RTLSDR_H
#define RTLSDR_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void rtlsdr_dev_t;

/* Device management */
__declspec(dllimport) uint32_t rtlsdr_get_device_count(void);
__declspec(dllimport) int rtlsdr_open(rtlsdr_dev_t **dev, uint32_t index);
__declspec(dllimport) int rtlsdr_close(rtlsdr_dev_t *dev);

/* Configuration */
__declspec(dllimport) int rtlsdr_set_center_freq(rtlsdr_dev_t *dev, uint32_t freq);
__declspec(dllimport) uint32_t rtlsdr_get_center_freq(rtlsdr_dev_t *dev);
__declspec(dllimport) int rtlsdr_set_sample_rate(rtlsdr_dev_t *dev, uint32_t rate);
__declspec(dllimport) int rtlsdr_set_tuner_gain_mode(rtlsdr_dev_t *dev, int manual);
__declspec(dllimport) int rtlsdr_set_tuner_gain(rtlsdr_dev_t *dev, int gain);
__declspec(dllimport) int rtlsdr_set_agc_mode(rtlsdr_dev_t *dev, int on);
__declspec(dllimport) int rtlsdr_reset_buffer(rtlsdr_dev_t *dev);

/* Synchronous read */
__declspec(dllimport) int rtlsdr_read_sync(rtlsdr_dev_t *dev, void *buf,
                                            int len, int *n_read);

#ifdef __cplusplus
}
#endif

#endif /* RTLSDR_H */
