"""AES-256-CTR frame encryption for CCSDS telemetry.

Encryption sits ABOVE FEC in the protocol stack:
    plaintext → encrypt → FEC encode → modulate → transmit

This mirrors where COMSEC sits in real spacecraft comms.
"""

import os
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


class FrameEncryptor:
    """AES-256-CTR encryptor/decryptor for CCSDS frames."""

    def __init__(self, key: bytes = None):
        """Initialize with AES-256 key.

        Args:
            key: 32-byte AES-256 key. Generated randomly if not provided.
        """
        self.key = key or os.urandom(32)
        if len(self.key) != 32:
            raise ValueError(f"Key must be 32 bytes, got {len(self.key)}")

    def encrypt_frame(self, plaintext: bytes) -> tuple:
        """Encrypt a frame using AES-256-CTR.

        Args:
            plaintext: Frame payload bytes.

        Returns:
            Tuple of (ciphertext, nonce). Nonce is 16 bytes.
        """
        nonce = os.urandom(16)
        cipher = Cipher(algorithms.AES(self.key), modes.CTR(nonce))
        encryptor = cipher.encryptor()
        ciphertext = encryptor.update(plaintext) + encryptor.finalize()
        return ciphertext, nonce

    def decrypt_frame(self, ciphertext: bytes, nonce: bytes) -> bytes:
        """Decrypt a frame using AES-256-CTR.

        Args:
            ciphertext: Encrypted frame payload bytes.
            nonce: 16-byte nonce used during encryption.

        Returns:
            Decrypted plaintext bytes.
        """
        cipher = Cipher(algorithms.AES(self.key), modes.CTR(nonce))
        decryptor = cipher.decryptor()
        return decryptor.update(ciphertext) + decryptor.finalize()

    @property
    def key_hex(self) -> str:
        """Return key as hex string."""
        return self.key.hex()
