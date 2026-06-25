#!/usr/bin/env bash
# Send a single authenticated Rain API request with the `Api-Key` header.
#
# Auth (per docs): every request carries `Api-Key: <YOUR_API_KEY>`. See the
# rain-api-auth skill for the full reference.
#
# Usage:
#   RAIN_API_KEY=... rain_curl.sh METHOD PATH_WITH_QUERY [BODY_FILE_OR_-]
#
# Examples:
#   rain_curl.sh GET  /issuing/transactions?limit=20
#   rain_curl.sh POST /issuing/keys key.json
#   echo '{"name":"x"}' | rain_curl.sh POST /issuing/keys -
#
# Environment:
#   RAIN_API_KEY        required — your Rain API key (also the webhook signing secret).
#   RAIN_ENV            optional — "dev" (default, sandbox) or "production".
#   RAIN_BASE           optional — override the base URL entirely (must end without
#                       a trailing slash; the /v1 prefix is part of the base URL).
#   RAIN_ALLOW_PROD=1   required to target production (RAIN_ENV=production / a prod
#                       RAIN_BASE). Guards against accidentally pasting a prod key.
set -euo pipefail

if [[ $# -lt 2 ]]; then
  sed -n '2,18p' "$0" >&2
  exit 2
fi

METHOD="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
PATH_Q="$2"
BODY_ARG="${3-}"

: "${RAIN_API_KEY:?set RAIN_API_KEY (your Rain API key from the developer dashboard)}"

RAIN_ENV="${RAIN_ENV:-dev}"
SANDBOX_BASE="https://api-dev.raincards.xyz/v1"
PROD_BASE="https://api.raincards.xyz/v1"

if [[ -n "${RAIN_BASE:-}" ]]; then
  BASE="${RAIN_BASE}"
  case "${BASE}" in
    *api-dev.raincards.xyz*) IS_PROD=0 ;;
    *) IS_PROD=1 ;;  # any non-sandbox base is treated as prod for the guard
  esac
else
  case "${RAIN_ENV}" in
    dev|sandbox)   BASE="${SANDBOX_BASE}"; IS_PROD=0 ;;
    prod|production) BASE="${PROD_BASE}";  IS_PROD=1 ;;
    *) echo "error: RAIN_ENV must be 'dev' or 'production' (got '${RAIN_ENV}')" >&2; exit 2 ;;
  esac
fi

if [[ "${IS_PROD}" == "1" && "${RAIN_ALLOW_PROD:-0}" != "1" ]]; then
  echo "error: refusing to call PRODUCTION without RAIN_ALLOW_PROD=1." >&2
  echo "       Default to sandbox (RAIN_ENV=dev). Never paste a production key to an agent." >&2
  exit 3
fi

if [[ "${PATH_Q}" != /* ]]; then
  echo "error: PATH must start with '/' (e.g. /issuing/transactions). Do not include the host or /v1." >&2
  exit 2
fi

BODY_FILE="$(mktemp)"
trap 'rm -f "${BODY_FILE}"' EXIT
if [[ -z "${BODY_ARG}" ]]; then
  : >"${BODY_FILE}"
elif [[ "${BODY_ARG}" == "-" ]]; then
  cat >"${BODY_FILE}"
else
  cp "${BODY_ARG}" "${BODY_FILE}"
fi

CURL_ARGS=(
  -sS -X "${METHOD}"
  -H "Api-Key: ${RAIN_API_KEY}"
  -H "Accept: application/json"
)

if [[ -s "${BODY_FILE}" ]]; then
  CURL_ARGS+=(-H "Content-Type: application/json" --data-binary "@${BODY_FILE}")
fi

curl "${CURL_ARGS[@]}" -w '\nHTTP %{http_code}\n' "${BASE}${PATH_Q}"
