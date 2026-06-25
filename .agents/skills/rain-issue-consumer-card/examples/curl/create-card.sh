#!/usr/bin/env bash
# Create a card for an approved Rain user. Addressed by userId.
# limit.amount is in CENTS. Returns an IssuingCard whose `id` is the cardId.
#
#   ./create-card.sh <userId> [virtual|physical]
set -euo pipefail

: "${RAIN_API_KEY:?set RAIN_API_KEY (sandbox)}"
BASE="${RAIN_BASE_URL:-https://api-dev.raincards.xyz/v1}"

USER_ID="${1:?usage: create-card.sh <userId> [virtual|physical]}"
TYPE="${2:-virtual}"

if [ "$TYPE" = "physical" ]; then
  # Physical: requires shipping (address + phoneNumber). Latin-only cardholder names.
  # method: standard | express | international | apc | uspsInternational
  BODY='{
    "type":"physical",
    "limit":{"amount":50000,"frequency":"per30DayPeriod"},
    "configuration":{"displayName":"JANE DOE"},
    "shipping":{
      "line1":"123 Main St","city":"New York","region":"NY","postalCode":"10001","countryCode":"US",
      "method":"standard","phoneNumber":"15555550123","firstName":"Jane","lastName":"Doe"
    }
  }'
else
  # Virtual: amount in cents (50000 = $500.00), rolling-30-day belt.
  BODY='{
    "type":"virtual",
    "limit":{"amount":50000,"frequency":"per30DayPeriod"},
    "configuration":{"displayName":"JANE DOE"}
  }'
fi

curl -sS -X POST "${BASE}/issuing/users/${USER_ID}/cards" \
  -H "Api-Key: ${RAIN_API_KEY}" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d "${BODY}"
