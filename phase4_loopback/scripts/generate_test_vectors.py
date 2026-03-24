#!/usr/bin/env python3
"""Generate test vectors for independent verification of the GROUNDLINK waveform.

Produces known-input/known-output pairs for:
- CCSDS framing (data → frame bytes)
- Randomization (frame → randomized frame)
- AES-256 encryption (plaintext + key → ciphertext)
"""

import sys
import os
import json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'phase3_ccsds_modem', 'gr-groundlink'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from python.ccsds_framer import CCSDSFramer
from python.ccsds_randomizer import CCSDSRandomizer
from python.ccsds_crc import ccsds_crc16
from crypto.aes_encrypt import FrameEncryptor

import click


@click.command()
@click.option('--output', type=click.Path(), default=None)
def main(output):
    """Generate test vectors for GROUNDLINK waveform verification."""
    vectors = {}

    # Test Vector 1: CRC-16
    test_data = b'\x00\x01\x02\x03\x04\x05\x06\x07'
    crc = ccsds_crc16(test_data)
    vectors['crc16'] = {
        'input_hex': test_data.hex(),
        'crc_hex': f'{crc:04x}',
        'crc_decimal': crc,
    }

    # Test Vector 2: CCSDS Frame
    framer = CCSDSFramer(spacecraft_id=0x1A, virtual_channel_id=0)
    payload = bytes(range(256)) * 4 + bytes(range(83))  # 1107 bytes
    frame = framer.make_frame(payload)
    vectors['ccsds_frame'] = {
        'spacecraft_id': '0x1A',
        'vcid': 0,
        'payload_length': len(payload),
        'frame_length': len(frame),
        'frame_header_hex': frame[:6].hex(),
        'frame_crc_hex': frame[-2:].hex(),
    }

    # Test Vector 3: Randomization
    rand = CCSDSRandomizer()
    short_data = bytes(range(32))
    randomized = rand.randomize(short_data)
    vectors['randomizer'] = {
        'input_hex': short_data.hex(),
        'output_hex': randomized.hex(),
        'lfsr_polynomial': 'x^8+x^7+x^5+x^3+1',
        'initial_state': '0xFF',
    }

    # Test Vector 4: AES-256-CTR encryption
    known_key = bytes.fromhex(
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
    known_nonce = bytes(16)  # all zeros for reproducibility
    enc = FrameEncryptor(key=known_key)

    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    cipher = Cipher(algorithms.AES(known_key), modes.CTR(known_nonce))
    encryptor = cipher.encryptor()
    plain = b'GROUNDLINK TEST VECTOR' + b'\x00' * 10
    ct = encryptor.update(plain) + encryptor.finalize()

    vectors['aes256_ctr'] = {
        'key_hex': known_key.hex(),
        'nonce_hex': known_nonce.hex(),
        'plaintext_hex': plain.hex(),
        'ciphertext_hex': ct.hex(),
    }

    # Output
    output_path = output or os.path.join(
        os.path.dirname(__file__), '..', 'data', 'test_vectors', 'test_vectors.json')
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(output_path, 'w') as f:
        json.dump(vectors, f, indent=2)

    click.echo(f"Test vectors written to {output_path}")
    for name, vec in vectors.items():
        click.echo(f"  {name}: {list(vec.keys())}")


if __name__ == '__main__':
    main()
