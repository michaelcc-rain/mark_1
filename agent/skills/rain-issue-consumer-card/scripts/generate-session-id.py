"""
Generate a Rain card-secret `SessionId` header value.

RSA-OAEP, OAEP hash = SHA-1, using the SessionId public key for your environment
(1024-bit — NOT the 2048-bit KYC key). Returns (secret_key, session_id):
  - session_id : put in the `SessionId` header (get-secrets) or `sessionid` (scoped card)
  - secret_key : KEEP IT — it is the input to decrypt_card_secret.py

Requires: pip install cryptography

Run:  python generate_session_id.py [dev|prod]
"""

import base64
import binascii
import secrets as _secrets
import sys

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

# ---------------------------------------------------------------------------
# SessionId public keys (1024-bit RSA). NOT the KYC keys.
# ---------------------------------------------------------------------------
DEV_SESSIONID_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCAP192809jZyaw62g/eTzJ3P9H
+RmT88sXUYjQ0K8Bx+rJ83f22+9isKx+lo5UuV8tvOlKwvdDS/pVbzpG7D7NO45c
0zkLOXwDHZkou8fuj8xhDO5Tq3GzcrabNLRLVz3dkx0znfzGOhnY4lkOMIdKxlQb
LuVM/dGDC9UpulF+UwIDAQAB
-----END PUBLIC KEY-----"""

PROD_SESSIONID_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCeZ9uCoxi2XvOw1VmvVLo88TLk
GE+OO1j3fa8HhYlJZZ7CCIAsaCorrU+ZpD5PUTnmME3DJk+JyY1BB3p8XI+C5uno
QucrbxFbkM1lgR10ewz/LcuhleG0mrXL/bzUZbeJqI6v3c9bXvLPKlsordPanYBG
FZkmBPxc8QEdRgH4awIDAQAB
-----END PUBLIC KEY-----"""


def generate_session_id(pem: str, secret: str | None = None) -> tuple[str, str]:
    """Return (secret_key_hex, session_id_base64)."""
    if not pem:
        raise ValueError("pem is required (a SessionId public key, 1024-bit)")
    if secret is not None and not all(c in "0123456789abcdefABCDEF" for c in secret):
        raise ValueError("secret must be a hex string")

    # 32 hex chars = 16 random bytes
    secret_key = secret if secret is not None else _secrets.token_bytes(16).hex()

    # base64 of the 16 RAW bytes, then RSA-encrypt the UTF-8 bytes of THAT base64 string
    raw = binascii.unhexlify(secret_key)
    secret_key_base64 = base64.b64encode(raw)  # bytes; this IS the UTF-8 of the b64 string

    public_key = serialization.load_pem_public_key(pem.encode())
    ciphertext = public_key.encrypt(
        secret_key_base64,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA1()),
            algorithm=hashes.SHA1(),
            label=None,
        ),
    )

    return secret_key, base64.b64encode(ciphertext).decode()


if __name__ == "__main__":
    pem = PROD_SESSIONID_PUBLIC_KEY if (len(sys.argv) > 1 and sys.argv[1] == "prod") else DEV_SESSIONID_PUBLIC_KEY
    sk, sid = generate_session_id(pem)
    # Do not log the secret in real usage.
    print({"session_id": sid, "secret_key_length": len(sk)})
