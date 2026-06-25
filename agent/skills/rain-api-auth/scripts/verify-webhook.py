#!/usr/bin/env python3
"""verify-webhook.py — Verify a Rain webhook HMAC-SHA256 signature. NO network.

Rain signs each webhook with HMAC-SHA256 keyed on your API KEY VALUE (the
dual-use signing key) over the JSON payload, hex-encoded, and puts the digest in
the `Signature` header. This script recomputes it and constant-time compares
against `Signature` (and, if present, `Secondary-Signature`).

NOTE ON WHAT TO SIGN: this follows Rain's documented example exactly — HMAC over
the body STRING. Pass the RAW request body string you received (do not
parse-then-re-serialize, or key order/whitespace may drift). See
references/signature-verification.md.

Usage:
    # Verify a captured delivery:
    RAIN_WEBHOOK_SIGNING_KEY=<key> \\
        python3 verify-webhook.py --body ./payload.json --signature <hex> [--secondary <hex>]

    # Built-in self-test (no key/args needed):
    python3 verify-webhook.py --self-test

Env:
    RAIN_WEBHOOK_SIGNING_KEY  the signing key value. Defaults to RAIN_API_KEY.
"""
import argparse
import hashlib
import hmac
import os
import sys


def compute_signature(body: str, signing_key: str) -> str:
    """Lowercase-hex HMAC-SHA256 of `body` keyed by `signing_key`."""
    return hmac.new(signing_key.encode(), body.encode(), hashlib.sha256).hexdigest()


def verify_rain_webhook(body: str, signing_key: str, signature: str,
                        secondary: str | None = None) -> bool:
    expected = compute_signature(body, signing_key)
    if signature and hmac.compare_digest(expected, signature):
        return True
    return bool(secondary) and hmac.compare_digest(expected, secondary)


def self_test() -> int:
    # The body is a FIXED literal string (byte-for-byte), so this self-test
    # produces the same digest as verify-webhook.js's self-test — proving the
    # algorithm is identical across languages. (Hashing a re-serialized object
    # instead would drift between languages; see references/signature-verification.md.)
    key = "test_signing_key_value"
    body = (
        '{"id":"550e8400-e29b-41d4-a716-446655440000","resource":"transaction",'
        '"action":"completed","version":"1.0.0","body":{"id":"txn_123456","type":"spend"}}'
    )
    sig = compute_signature(body, key)
    ok = verify_rain_webhook(body, key, sig)
    tampered = verify_rain_webhook(body + " ", key, sig)  # must NOT verify
    print("self-test signature:", sig)
    print("verify(correct):    ", "PASS" if ok else "FAIL")
    print("verify(tampered):   ", "FAIL (should reject!)" if tampered else "PASS (rejected)")
    return 0 if (ok and not tampered) else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify a Rain webhook HMAC-SHA256 signature.")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--body", help="path to the raw request body file")
    parser.add_argument("--signature", help="the Signature header value (hex)")
    parser.add_argument("--secondary", help="the Secondary-Signature header value (hex), if present")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    signing_key = os.environ.get("RAIN_WEBHOOK_SIGNING_KEY") or os.environ.get("RAIN_API_KEY")
    if not signing_key:
        print("FAIL: set RAIN_WEBHOOK_SIGNING_KEY (or RAIN_API_KEY) to the signing key value.")
        return 1
    if not args.body or not args.signature:
        print("Usage: python3 verify-webhook.py --body <file> --signature <hex> [--secondary <hex>]")
        print("   or: python3 verify-webhook.py --self-test")
        return 1

    with open(args.body, "r", encoding="utf-8") as fh:
        body = fh.read()

    if verify_rain_webhook(body, signing_key, args.signature, args.secondary):
        print("OK: signature verified. Safe to process the payload.")
        return 0

    print("FAIL: signature did NOT verify. Do not process the payload.")
    print("  - Confirm the signing key is the one currently selected in the dashboard.")
    print("  - Confirm --body is the RAW bytes received (not re-serialized).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
