#!/usr/bin/env python3
"""verify-signature.py — verify a Rain webhook signature (HMAC-SHA256).

Scheme (identical to rain-api-auth's signature-verification reference):
    signature = HMAC_SHA256(key=<YOUR_API_KEY_VALUE>, message=<RAW_REQUEST_BODY>).hexdigest()

IMPORTANT: HMAC over the RAW request body bytes EXACTLY as received — do NOT
json.loads then json.dumps. Re-serializing can reorder keys / change whitespace
and break the match. The API key value doubles as the webhook signing secret;
rotating the key rotates webhook signing too.

Compares against the `Signature` header, falling back to `Secondary-Signature`
(present during key rotation). Constant-time compare via hmac.compare_digest.

As a module:
    from verify_signature import verify_rain_signature
    ok = verify_rain_signature(raw_body, request.headers, os.environ["RAIN_API_KEY"])

As a CLI (test against a saved payload):
    RAIN_API_KEY=... python3 verify-signature.py <payload.json> <signature-hex> [secondary-hex]
"""

import hashlib
import hmac
import os
import sys
from typing import Mapping, Optional, Union


def _compute_hex(raw_body: Union[bytes, str], api_key: str) -> str:
    body = raw_body.encode() if isinstance(raw_body, str) else raw_body
    return hmac.new(api_key.encode(), body, hashlib.sha256).hexdigest()


def _get_header(headers: Mapping[str, str], name: str) -> Optional[str]:
    # Support dict-like and frameworks with case-insensitive .get (Flask/FastAPI/requests).
    if headers is None:
        return None
    getter = getattr(headers, "get", None)
    if callable(getter):
        val = getter(name)
        if val is not None:
            return val
    lower = name.lower()
    for k, v in dict(headers).items():
        if str(k).lower() == lower:
            return v
    return None


def verify_rain_signature(
    raw_body: Union[bytes, str],
    headers: Mapping[str, str],
    api_key: str,
) -> bool:
    """Return True iff the `Signature` or `Secondary-Signature` header matches.

    :param raw_body: raw request body EXACTLY as received (no re-serialization).
    :param headers:  incoming request headers (case-insensitive lookup).
    :param api_key:  your Rain API key value (the webhook signing secret).
    """
    if not api_key:
        raise ValueError("Missing API key (webhook signing secret).")

    expected = _compute_hex(raw_body, api_key)
    for header_name in ("Signature", "Secondary-Signature"):
        provided = _get_header(headers, header_name)
        if not provided:
            continue
        # compare_digest is constant-time and length-safe for hex strings.
        if hmac.compare_digest(provided.strip(), expected):
            return True
    return False


# --- CLI -------------------------------------------------------------------
if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(
            "Usage: RAIN_API_KEY=... python3 verify-signature.py "
            "<payload.json> <signature-hex> [secondary-hex]\n"
            "Tip: to GENERATE a signature for a sample payload, run:\n"
            "  RAIN_API_KEY=... python3 -c \"import hashlib,hmac,os,sys;"
            "print(hmac.new(os.environ['RAIN_API_KEY'].encode(),"
            "open(sys.argv[1],'rb').read(),hashlib.sha256).hexdigest())\" <payload.json>",
            file=sys.stderr,
        )
        sys.exit(2)

    api_key = os.environ.get("RAIN_API_KEY")
    if not api_key:
        print("Set RAIN_API_KEY (your API key value = webhook signing secret).", file=sys.stderr)
        sys.exit(2)

    payload_path = sys.argv[1]
    sig_hex = sys.argv[2]
    secondary_hex = sys.argv[3] if len(sys.argv) > 3 else None

    with open(payload_path, "rb") as fh:
        raw = fh.read()  # raw bytes, no parse

    hdrs = {"Signature": sig_hex}
    if secondary_hex:
        hdrs["Secondary-Signature"] = secondary_hex

    valid = verify_rain_signature(raw, hdrs, api_key)
    print("VALID — signature matches" if valid else "INVALID — no matching signature")
    sys.exit(0 if valid else 1)
