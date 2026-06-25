#!/usr/bin/env bash
# Retrieve a card's ENCRYPTED secrets, then decrypt them.
# Header is PascalCase `SessionId` for this endpoint.
#
#   ./get-secrets.sh <cardId> [dev|prod]
#
# Steps:
#   1. generate a SessionId (RSA-OAEP+SHA-1 under the SessionId key) — keep the secretKey
#   2. GET /issuing/cards/{cardId}/secrets with the SessionId header
#   3. AES-128-GCM decrypt each {iv,data} with the corrected decrypt script
#
# This uses the bundled scripts so the crypto is correct end-to-end.
set -euo pipefail

: "${RAIN_API_KEY:?set RAIN_API_KEY (sandbox)}"
BASE="${RAIN_BASE_URL:-https://api-dev.raincards.xyz/v1}"
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../scripts" && pwd)"

CARD_ID="${1:?usage: get-secrets.sh <cardId> [dev|prod]}"
ENV="${2:-dev}"

# 1. generate the session id (prints JSON: {sessionId, secretKey}). We need BOTH:
#    sessionId for the header, secretKey for decryption. Use node with the TS helper.
read -r SESSION_ID SECRET_KEY < <(node --input-type=module -e "
  import { generateSessionId, DEV_SESSIONID_PUBLIC_KEY, PROD_SESSIONID_PUBLIC_KEY } from '${SCRIPTS}/generate-session-id.ts';
  const pem = '${ENV}' === 'prod' ? PROD_SESSIONID_PUBLIC_KEY : DEV_SESSIONID_PUBLIC_KEY;
  const o = generateSessionId(pem);
  process.stdout.write(o.sessionId + ' ' + o.secretKey);
" 2>/dev/null) || { echo "session-id generation failed (need: npx tsx / node with TS loader)"; exit 1; }

# 2. fetch the encrypted secrets
SECRETS="$(curl -sS "${BASE}/issuing/cards/${CARD_ID}/secrets" \
  -H "Api-Key: ${RAIN_API_KEY}" \
  -H "SessionId: ${SESSION_ID}" \
  -H "accept: application/json")"

echo "encrypted response:"
echo "${SECRETS}" | jq .

# 3. decrypt PAN + CVC (arg order: data, iv, secretKey). Prints only last4.
node --input-type=module -e "
  import { decryptSecret } from '${SCRIPTS}/decrypt-card-secret.ts';
  const s = ${SECRETS};
  const pan = decryptSecret(s.encryptedPan.data, s.encryptedPan.iv, '${SECRET_KEY}');
  decryptSecret(s.encryptedCvc.data, s.encryptedCvc.iv, '${SECRET_KEY}'); // never log CVC
  console.log('issued card ending', pan.slice(-4));
"
