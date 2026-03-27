CC      = gcc
CFLAGS  = -O2 -Wall -Wextra
LDFLAGS = -lrtlsdr -lm -lpthread

BINS = groundlink_adsb groundlink_uat groundlink_radio

all: $(BINS)

groundlink_adsb: groundlink_adsb.c
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS)

groundlink_uat: groundlink_uat.c
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS)

groundlink_radio: groundlink_radio.c
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS)

clean:
	rm -f $(BINS)

.PHONY: all clean
