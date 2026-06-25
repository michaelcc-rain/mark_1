#!/usr/bin/env bash
# Upload one KYC document to a Rain application. PUT, multipart, addressed by userId.
# Success is HTTP 204 (no body). Call once per document.
#
#   ./upload-document.sh <userId> <file> <type> [side] [countryCode]
#
# type: passport | idCard | drivers | residencePermit | selfie (KYC-accepted set)
# side: front | back   -> ID card / drivers / residencePermit ONLY; OMIT for passport/selfie
#
# Files up to 20 MB. A 400 with "Document rejected" is a fastfail — parse the message /
# errorMessageCodes for the rejection tags (see references/document-requirements.md).
set -euo pipefail

: "${RAIN_API_KEY:?set RAIN_API_KEY (sandbox)}"
BASE="${RAIN_BASE_URL:-https://api-dev.raincards.xyz/v1}"

USER_ID="${1:?usage: upload-document.sh <userId> <file> <type> [side] [countryCode]}"
FILE="${2:?missing file path}"
TYPE="${3:?missing document type}"
SIDE="${4:-}"
COUNTRY="${5:-}"

ARGS=(-F "document=@${FILE}" -F "type=${TYPE}")
[ -n "$SIDE" ]    && ARGS+=(-F "side=${SIDE}")
[ -n "$COUNTRY" ] && ARGS+=(-F "countryCode=${COUNTRY}")

# -w prints the HTTP status so you can confirm the 204.
curl -sS -o /dev/null -w "HTTP %{http_code}\n" -X PUT \
  "${BASE}/issuing/applications/user/${USER_ID}/document" \
  -H "Api-Key: ${RAIN_API_KEY}" \
  "${ARGS[@]}"
