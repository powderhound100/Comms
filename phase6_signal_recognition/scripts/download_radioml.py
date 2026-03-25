#!/usr/bin/env python3
"""Download and extract the RadioML 2016.10a dataset."""

import sys
import os
import ssl
import bz2
import urllib.request
from pathlib import Path

# Download URLs (try in order)
URLS = [
    "https://opendata.deepsig.io/datasets/2016.10/RML2016.10a_dict.pkl.bz2",
]

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
BZ2_PATH = DATA_DIR / "RML2016.10a_dict.pkl.bz2"
PKL_PATH = DATA_DIR / "RML2016.10a_dict.pkl"


def download_with_progress(url: str, dest: Path) -> None:
    """Download file with progress bar."""
    print(f"Downloading: {url}")
    print(f"Destination: {dest}")

    def reporthook(block_num, block_size, total_size):
        downloaded = block_num * block_size
        if total_size > 0:
            pct = min(100, downloaded * 100 / total_size)
            mb = downloaded / (1024 * 1024)
            total_mb = total_size / (1024 * 1024)
            sys.stdout.write(f"\r  {pct:5.1f}% ({mb:.1f}/{total_mb:.1f} MB)")
            sys.stdout.flush()

    # Try with default SSL first, fall back to unverified if cert is expired
    try:
        urllib.request.urlretrieve(url, str(dest), reporthook=reporthook)
    except urllib.error.URLError as e:
        if "CERTIFICATE_VERIFY_FAILED" in str(e):
            print("\n  SSL cert issue, retrying with unverified context...")
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            opener = urllib.request.build_opener(
                urllib.request.HTTPSHandler(context=ctx)
            )
            urllib.request.install_opener(opener)
            urllib.request.urlretrieve(url, str(dest), reporthook=reporthook)
        else:
            raise
    print()


def decompress_bz2(src: Path, dest: Path) -> None:
    """Decompress .bz2 file."""
    print(f"Decompressing: {src}")
    with bz2.open(src, "rb") as f_in, open(dest, "wb") as f_out:
        chunk_size = 1024 * 1024  # 1 MB chunks
        total = 0
        while True:
            chunk = f_in.read(chunk_size)
            if not chunk:
                break
            f_out.write(chunk)
            total += len(chunk)
            sys.stdout.write(f"\r  Extracted: {total / (1024 * 1024):.1f} MB")
            sys.stdout.flush()
    print()


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if PKL_PATH.exists():
        size_mb = PKL_PATH.stat().st_size / (1024 * 1024)
        print(f"Dataset already exists: {PKL_PATH} ({size_mb:.1f} MB)")
        return

    # Download — try each URL
    if not BZ2_PATH.exists():
        for url in URLS:
            try:
                download_with_progress(url, BZ2_PATH)
                break
            except Exception as e:
                print(f"  Failed: {e}")
                if BZ2_PATH.exists():
                    BZ2_PATH.unlink()
                continue
        else:
            print("All download URLs failed.")
            sys.exit(1)
    else:
        print(f"Compressed file exists: {BZ2_PATH}")

    # Decompress
    decompress_bz2(BZ2_PATH, PKL_PATH)

    # Clean up compressed file
    BZ2_PATH.unlink()
    print(f"\nDataset ready: {PKL_PATH}")

    # Quick validation
    import pickle
    with open(PKL_PATH, "rb") as f:
        data = pickle.load(f, encoding="latin1")
    print(f"Loaded {len(data)} (modulation, SNR) pairs")

    mods = sorted(set(mod for mod, snr in data.keys()))
    print(f"Modulations: {mods}")


if __name__ == "__main__":
    main()
