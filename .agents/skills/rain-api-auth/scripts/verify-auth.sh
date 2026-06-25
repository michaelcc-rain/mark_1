#!/usr/bin/env bash
# verify-auth.sh — Smoke-test Rain API auth with curl (no SDK).
#
# GETs /companies with the canonical Api-Key header and reports the HTTP status.
# No data is mutated. This is the first-class path for any language without an
# official SDK.
#
# Usage:
#   RAIN_API_KEY=<sandbox-key> RAIN_ENV=dev ./verify-auth.sh
#
# Env:
#   RAIN_API_KEY  (required) your sandbox API key value
#   RAIN_ENV      'dev' (default) | 'production'
set -euo pipefail

if [[ -z "${RAIN_API_KEY:-}" ]]; then
  echo "FAIL: RAIN_API_KEY is not set. Export your sandbox key first." >&2
  exit 1
fi

ENV="${RAIN_ENV:-dev}"
if [[ "$ENV" == "production" ]]; then
  BASE="https://api.raincards.xyz/v1"
else
  BASE="https://api-dev.raincards.xyz/v1"
fi

# -s silent, -o discard body, -w print status; canonical Api-Key header.
STATUS="$(curl -s -o /dev/null -w '%{http_code}' \
  -X GET "${BASE}/companies" \
  -H "Api-Key: ${RAIN_API_KEY}")"

case "$STATUS" in
  200)
    echo "OK: authenticated to '${ENV}' (${BASE}). GET /companies returned 200."
    ;;
  401)
    echo "FAIL (401): bad key or wrong environment. A sandbox key only works against 'dev'" >&2
    echo "            (api-dev.raincards.xyz); a prod key only against 'production'." >&2
    echo "            If the body says \"Address invalid for API key\", it's the IP allowlist." >&2
    exit 1
    ;;
  403)
    echo "FAIL (403): the key authenticated but lacks permission for GET /companies." >&2
    exit 1
    ;;
  *)
    echo "FAIL (${STATUS}): unexpected status from ${BASE}/companies." >&2
    exit 1
    ;;
esac
