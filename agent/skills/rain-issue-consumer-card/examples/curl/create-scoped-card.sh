#!/usr/bin/env bash
# Create a scoped (agent) card. Secrets are returned INLINE in the response.
# Header is lowercase `sessionid` for this endpoint (contrast get-secrets' `SessionId`).
#
#   ./create-scoped-card.sh <userId> [amountInUSDCents] [dev|prod]
#
# ⚠️ Gated: must be enabled for your tenant during onboarding, else 403.
# ⚠️ /cards/agentic is DEPRECATED — this uses /cards/scoped.
# Lifetime limit is capped at 1.2x the amount to absorb auth holds.
set -euo pipefail

: "${RAIN_API_KEY:?set RAIN_API_KEY (sandbox)}"
BASE="${RAIN_BASE_URL:-https://api-dev.raincards.xyz/v1}"
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../scripts" && pwd)"

USER_ID="${1:?usage: create-scoped-card.sh <userId> [amountInUSDCents] [dev|prod]}"
AMOUNT="${2:-4299}"   # $42.99 -> lifetime cap 1.2x = $51.59
ENV="${3:-dev}"

# generate the session id; keep the secretKey for decrypting the inline secrets
read -r SESSION_ID SECRET_KEY < <(node --input-type=module -e "
  import { generateSessionId, DEV_SESSIONID_PUBLIC_KEY, PROD_SESSIONID_PUBLIC_KEY } from '${SCRIPTS}/generate-session-id.ts';
  const pem = '${ENV}' === 'prod' ? PROD_SESSIONID_PUBLIC_KEY : DEV_SESSIONID_PUBLIC_KEY;
  const o = generateSessionId(pem);
  process.stdout.write(o.sessionId + ' ' + o.secretKey);
" 2>/dev/null) || { echo "session-id generation failed"; exit 1; }

RESP="$(curl -sS -X POST "${BASE}/issuing/users/${USER_ID}/cards/scoped" \
  -H "Api-Key: ${RAIN_API_KEY}" \
  -H "sessionid: ${SESSION_ID}" \
  -H "Content-Type: application/json" \
  -d "{\"amountInUSDCents\": ${AMOUNT}}")"

echo "scoped card response:"
echo "${RESP}" | jq '{id, last4, status, expirationMonth, expirationYear}'

# decrypt the inline secrets (same SessionId key + AES-128-GCM). Prints only last4.
node --input-type=module -e "
  import { decryptSecret } from '${SCRIPTS}/decrypt-card-secret.ts';
  const s = ${RESP};
  if (!s.encryptedPan) { console.error('no secrets in response (403? check tenant enablement)'); process.exit(1); }
  const pan = decryptSecret(s.encryptedPan.data, s.encryptedPan.iv, '${SECRET_KEY}');
  console.log('scoped card ending', pan.slice(-4));
"
