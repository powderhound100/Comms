#!/usr/bin/env python3
"""Measure encryption/decryption throughput and overhead."""

import time
import os
import click
from aes_encrypt import FrameEncryptor


@click.command()
@click.option('--frame-size', type=int, default=1107, help='Frame payload size (bytes)')
@click.option('--num-frames', type=int, default=10000, help='Number of frames to process')
def main(frame_size, num_frames):
    """Measure AES-256-CTR encryption overhead."""
    encryptor = FrameEncryptor()

    # Generate test data
    frames = [os.urandom(frame_size) for _ in range(num_frames)]

    # Encryption throughput
    t_start = time.perf_counter()
    encrypted = []
    for frame in frames:
        ct, nonce = encryptor.encrypt_frame(frame)
        encrypted.append((ct, nonce))
    t_encrypt = time.perf_counter() - t_start

    # Decryption throughput
    t_start = time.perf_counter()
    for ct, nonce in encrypted:
        encryptor.decrypt_frame(ct, nonce)
    t_decrypt = time.perf_counter() - t_start

    total_bytes = frame_size * num_frames
    total_bits = total_bytes * 8

    click.echo(f"{'='*50}")
    click.echo(f"  AES-256-CTR Overhead Analysis")
    click.echo(f"{'='*50}")
    click.echo(f"  Frame size:      {frame_size} bytes")
    click.echo(f"  Frames:          {num_frames}")
    click.echo(f"  Total data:      {total_bytes/1e6:.1f} MB")
    click.echo(f"  Nonce overhead:  {16*num_frames/1e3:.1f} KB ({16/frame_size*100:.1f}%)")
    click.echo(f"  Encrypt time:    {t_encrypt*1000:.1f} ms ({total_bits/t_encrypt/1e6:.1f} Mbps)")
    click.echo(f"  Decrypt time:    {t_decrypt*1000:.1f} ms ({total_bits/t_decrypt/1e6:.1f} Mbps)")
    click.echo(f"  Per-frame lat:   {t_encrypt/num_frames*1e6:.1f} µs encrypt, "
               f"{t_decrypt/num_frames*1e6:.1f} µs decrypt")


if __name__ == '__main__':
    main()
