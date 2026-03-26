#!/usr/bin/env python3
"""Encryption integration test — verify encrypt/decrypt round-trip and wrong-key rejection."""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from crypto.aes_encrypt import FrameEncryptor


def test_round_trip():
    """Verify encrypt → decrypt produces original data."""
    enc = FrameEncryptor()
    plaintext = b'GROUNDLINK test frame payload ' * 37  # ~1110 bytes

    ciphertext, nonce = enc.encrypt_frame(plaintext)
    decrypted = enc.decrypt_frame(ciphertext, nonce)

    assert decrypted == plaintext, "Round-trip failed!"
    assert ciphertext != plaintext, "Ciphertext should differ from plaintext!"
    print("PASS: Encrypt/decrypt round-trip")


def test_wrong_key_rejection():
    """Verify wrong key produces garbage output."""
    enc1 = FrameEncryptor()
    enc2 = FrameEncryptor()  # Different random key

    plaintext = b'Sensitive telemetry data ' * 44
    ciphertext, nonce = enc1.encrypt_frame(plaintext)

    # Decrypt with wrong key
    wrong_decrypt = enc2.decrypt_frame(ciphertext, nonce)
    assert wrong_decrypt != plaintext, "Wrong key should not decrypt correctly!"
    print("PASS: Wrong-key rejection")


def test_nonce_uniqueness():
    """Verify each encryption produces a unique nonce."""
    enc = FrameEncryptor()
    data = b'test' * 100
    nonces = set()
    for _ in range(100):
        _, nonce = enc.encrypt_frame(data)
        nonces.add(nonce)
    assert len(nonces) == 100, "Nonces should be unique!"
    print("PASS: Nonce uniqueness")


def test_ciphertext_length():
    """Verify ciphertext length equals plaintext length (CTR mode)."""
    enc = FrameEncryptor()
    for size in [100, 1107, 4096]:
        plaintext = os.urandom(size)
        ciphertext, _ = enc.encrypt_frame(plaintext)
        assert len(ciphertext) == size, f"Length mismatch: {len(ciphertext)} != {size}"
    print("PASS: Ciphertext length preservation")


if __name__ == '__main__':
    test_round_trip()
    test_wrong_key_rejection()
    test_nonce_uniqueness()
    test_ciphertext_length()
    print("\nAll encryption tests passed!")
