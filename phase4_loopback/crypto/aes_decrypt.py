"""AES-256-CTR frame decryption — standalone decryptor for RX side.

In a real system, the decryptor would be on the ground station receiver,
operating on frames after FEC decoding and deframing.
"""

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


class FrameDecryptor:
    """AES-256-CTR decryptor for received CCSDS frames."""

    def __init__(self, key: bytes):
        """Initialize with shared AES-256 key.

        Args:
            key: 32-byte AES-256 key (must match encryptor's key).
        """
        if len(key) != 32:
            raise ValueError(f"Key must be 32 bytes, got {len(key)}")
        self.key = key

    def decrypt_frame(self, ciphertext: bytes, nonce: bytes) -> bytes:
        """Decrypt a frame.

        Args:
            ciphertext: Encrypted data.
            nonce: 16-byte nonce from encryption.

        Returns:
            Decrypted plaintext.
        """
        cipher = Cipher(algorithms.AES(self.key), modes.CTR(nonce))
        decryptor = cipher.decryptor()
        return decryptor.update(ciphertext) + decryptor.finalize()

    @classmethod
    def from_hex_key(cls, hex_key: str) -> 'FrameDecryptor':
        """Create decryptor from hex-encoded key string."""
        return cls(bytes.fromhex(hex_key))
