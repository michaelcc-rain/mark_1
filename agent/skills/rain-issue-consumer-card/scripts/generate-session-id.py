"""
Generate a Rain card-secret `SessionId` header value.

RSA-OAEP, OAEP hash = SHA-512, using the SessionId public key for your environment
(2048-bit; NOT the KYC-payload key, which is a different 2048-bit keypair). Returns (secret_key, session_id):
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
# SessionId public keys (2048-bit RSA, RSA-OAEP/SHA-512). NOT the KYC keys.
# Source: Rain docs, "SessionId Public Keys (Development and Production)".
# ---------------------------------------------------------------------------
DEV_SESSIONID_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4LPy3Nlj7AiPUmCxQ2rG
Vb2PEr36xTz7Zqnoav9e6fWJzR+IPUpQqTerrrfQaNg6xAXhvNVuTbZfRHV0LDtX
cpco43nhupBMPzWbjIP2C0QlOXxD1NT9p0vuRBPLnT8z3JHnL7fWqx0dx3v6BeFq
hMo235xR68qLDDjFXIV0FOmI6x1SJS76MwwlAqRHsxSEWJix4WxuK4Z/RrqIuX5J
O1yRInG4ENBtFbUmc3CO6fVVUpuuSCMwFmFrxQKFcOdWIc2pzN8NDhvlbGRXg2N9
vX8g1OQt4F6WxX39C917niCksen2lqTWoaR6qoW3JxehivLsnWgfM3vWOrUTaH2L
OQIDAQAB
-----END PUBLIC KEY-----"""

PROD_SESSIONID_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAowLTDgfW/U8+2dy6Uu8L
hOnfjaW6YVriYqkmtZMoI86h1xonzf5cJ4BO9ejrdl2kTDtOFiNj7JcMWc35o5x+
zooA6AmRArl0HQV+Ir7wd5vF91107jKq2f1XB3HQA80UW61VWe1fhpSJwu1ye5k5
6Eqrgmg1R3ypmXuMVm5897z+w/zCQZ2IOqb3cVbrRdcte6028eUjVGrSVD/ooShg
Hh7BZ6p0GSzbJ2KbxOM4UfcAo3XCz0/VTnerbPdmHkaGVIElFOnxGXM8wEWueRQQ
DmdHnDe/o/kuyO5uSUc8fvso2V6iZC9b5PGADU4bbTtuVuUulLky3RwaACWA6q4Q
cwIDAQAB
-----END PUBLIC KEY-----"""


def generate_session_id(pem: str, secret: str | None = None) -> tuple[str, str]:
    """Return (secret_key_hex, session_id_base64)."""
    if not pem:
        raise ValueError("pem is required (a SessionId public key, 2048-bit)")
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
            mgf=padding.MGF1(algorithm=hashes.SHA512()),
            algorithm=hashes.SHA512(),
            label=None,
        ),
    )

    return secret_key, base64.b64encode(ciphertext).decode()


if __name__ == "__main__":
    pem = PROD_SESSIONID_PUBLIC_KEY if (len(sys.argv) > 1 and sys.argv[1] == "prod") else DEV_SESSIONID_PUBLIC_KEY
    sk, sid = generate_session_id(pem)
    # Do not log the secret in real usage.
    print({"session_id": sid, "secret_key_length": len(sk)})
