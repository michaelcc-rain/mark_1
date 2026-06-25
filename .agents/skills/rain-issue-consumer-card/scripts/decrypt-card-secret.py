"""
Decrypt a Rain encrypted card secret (PAN or CVC).

CORRECTED AES-128-GCM. The wire format is `ciphertext || 16-byte GCM tag`. This impl
splits off the last 16 bytes as the tag, decrypts only the ciphertext, and verifies the
tag (raising InvalidTag on mismatch).

Inputs come from `GET /issuing/cards/{cardId}/secrets` (or the scoped-card response):
  { "encryptedPan": {"iv","data"}, "encryptedCvc": {"iv","data"} }
`secret_key` is the 32-char hex string returned by generate_session_id.

NOTE arg order: (base64_data, base64_iv, secret_key) — data first, then iv.
SECURITY: never log the return value.

Requires: pip install cryptography
Self-test:  python decrypt_card_secret.py --selftest
"""

import base64
import binascii
import os
import sys

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def decrypt_secret(base64_data: str, base64_iv: str, secret_key_hex: str) -> str:
    if not base64_data:
        raise ValueError("base64_data is required")
    if not base64_iv:
        raise ValueError("base64_iv is required")
    if not secret_key_hex or not all(c in "0123456789abcdefABCDEF" for c in secret_key_hex):
        raise ValueError("secret_key must be a hex string")

    key = binascii.unhexlify(secret_key_hex)  # 16 bytes -> AES-128
    iv = base64.b64decode(base64_iv)
    buf = base64.b64decode(base64_data)        # ciphertext || 16-byte tag

    # cryptography's AESGCM.decrypt expects (ciphertext_with_tag_appended); it slices the
    # trailing 16-byte tag and verifies it automatically — the correct GCM behavior.
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(iv, buf, None)
    return plaintext.decode("utf-8")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        secret_key = "00112233445566778899aabbccddeeff"
        key = binascii.unhexlify(secret_key)
        iv = os.urandom(12)
        known = "4111111111111111"
        ct_with_tag = AESGCM(key).encrypt(iv, known.encode(), None)  # appends the tag
        data = base64.b64encode(ct_with_tag).decode()
        out = decrypt_secret(data, base64.b64encode(iv).decode(), secret_key)
        assert out == known and len(out) == len(known), f'round-trip failed: {out!r}'
        print("self-test OK: round-trip exact, no trailing bytes")
