#!/usr/bin/env python3
"""verify-auth.py — Smoke-test Rain API auth with the Python SDK.

Initializes the Rain client from RAIN_API_KEY and calls companies.list().
Prints a success/failure line. No data is mutated.

Usage:
    RAIN_API_KEY=<sandbox-key> RAIN_ENV=dev python3 verify-auth.py

Env:
    RAIN_API_KEY  (required) your sandbox API key value
    RAIN_ENV      'dev' (default) | 'production'

Requires: pip install rain-sdk
"""
import os
import sys

from rain_sdk import Rain, AuthenticationError, PermissionDeniedError


def main() -> int:
    api_key = os.environ.get("RAIN_API_KEY")
    if not api_key:
        print("FAIL: RAIN_API_KEY is not set. Export your sandbox key first.")
        return 1

    environment = os.environ.get("RAIN_ENV", "dev")
    client = Rain(api_key=api_key, environment=environment)

    try:
        companies = client.companies.list()
        count = len(companies) if isinstance(companies, list) else "unknown"
        print(f"OK: authenticated to '{environment}'. companies.list() returned {count} item(s).")
        return 0
    except AuthenticationError:
        print("FAIL (401): bad key or wrong environment. "
              "A sandbox key only works against 'dev'; a prod key only against 'production'.")
        return 1
    except PermissionDeniedError:
        print("FAIL (403): the key authenticated but lacks permission for companies.list().")
        return 1
    except Exception as err:  # noqa: BLE001 - surface anything else
        print(f"FAIL: {err}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
