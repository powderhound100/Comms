/*
 * rtlsdr.h — Minimal librtlsdr API header for GROUNDLINK decoders.
 *
 * Declares only the functions we use. On Windows, links against
 * rtlsdr.dll/.lib; on Linux, links against system librtlsdr (-lrtlsdr).
 */

#ifndef RTLSDR_H
#define RTLSDR_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void rtlsdr_dev_t;

/* Import declaration: only needed on Windows DLL builds */
#ifdef _WIN32
#define RTLSDR_API __declspec(dllimport)
#else
#define RTLSDR_API
#endif

/* Device management */
RTLSDR_API uint32_t rtlsdr_get_device_count(void);
RTLSDR_API const char *rtlsdr_get_device_name(uint32_t index);
RTLSDR_API int rtlsdr_get_device_usb_strings(uint32_t index,
    char *manufact, char *product, char *serial);
RTLSDR_API int rtlsdr_get_index_by_serial(const char *serial);
RTLSDR_API int rtlsdr_open(rtlsdr_dev_t **dev, uint32_t index);
RTLSDR_API int rtlsdr_close(rtlsdr_dev_t *dev);

/* Configuration */
RTLSDR_API int rtlsdr_set_center_freq(rtlsdr_dev_t *dev, uint32_t freq);
RTLSDR_API uint32_t rtlsdr_get_center_freq(rtlsdr_dev_t *dev);
RTLSDR_API int rtlsdr_set_sample_rate(rtlsdr_dev_t *dev, uint32_t rate);
RTLSDR_API int rtlsdr_set_tuner_gain_mode(rtlsdr_dev_t *dev, int manual);
RTLSDR_API int rtlsdr_set_tuner_gain(rtlsdr_dev_t *dev, int gain);
RTLSDR_API int rtlsdr_get_tuner_gain(rtlsdr_dev_t *dev);
RTLSDR_API int rtlsdr_get_tuner_gains(rtlsdr_dev_t *dev, int *gains);
RTLSDR_API int rtlsdr_set_agc_mode(rtlsdr_dev_t *dev, int on);
RTLSDR_API int rtlsdr_reset_buffer(rtlsdr_dev_t *dev);

/* Synchronous read */
RTLSDR_API int rtlsdr_read_sync(rtlsdr_dev_t *dev, void *buf,
                                  int len, int *n_read);

#ifdef __cplusplus
}
#endif

#endif /* RTLSDR_H */
