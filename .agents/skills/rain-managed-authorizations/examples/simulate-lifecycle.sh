#!/usr/bin/env bash
#
# simulate-lifecycle.sh — drive a full spend lifecycle against the Rain SANDBOX
# simulate API so you can watch your webhook receiver process every event.
#
# DEV ONLY. The simulate endpoints exist only on the sandbox host; production
# returns 404. They create REAL transaction records, fire REAL webhooks, and
# update balances — without moving real funds. Network is always VISA.
#
# Prerequisites:
#   - A sandbox RAIN_API_KEY (Api-Key header auth).
#   - An ACTIVE card (locked/canceled/unactivated cards cannot be simulated
#     against). Issue + activate via rain-issue-consumer-card.
#   - Funded collateral so there is a usable balance (POST /simulate/collateral/fund).
#   - Your webhook receiver registered (dashboard) + reachable via a public
#     tunnel (loopback is blocked). See SKILL.md Step 1.
#
# Expect a `transaction.requested` webhook in sandbox — IGNORE it under
# Rain-Managed (the simulator emits requested+created for every program).
#
# Usage:
#   RAIN_API_KEY=sk_dev_... ./simulate-lifecycle.sh <CARD_ID> [flow]
#     flow = standard | incremental | partial-reversal | full-reversal |
#            decline | refund   (default: standard)
#
# Requires: curl, jq.

set -euo pipefail

BASE="${RAIN_BASE_URL:-https://api-dev.raincards.xyz/v1}"
CARD_ID="${1:?Usage: ./simulate-lifecycle.sh <CARD_ID> [flow]}"
FLOW="${2:-standard}"

: "${RAIN_API_KEY:?Set RAIN_API_KEY (sandbox key).}"

case "$BASE" in
  *api-dev.raincards.xyz*) : ;;  # sandbox — good
  *) echo "REFUSING: simulate endpoints are sandbox-only. RAIN_BASE_URL must be the api-dev host." >&2; exit 2 ;;
esac

api() {
  # api METHOD PATH [JSON_BODY]
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" "${BASE}${path}" \
      -H "Api-Key: ${RAIN_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -sS -X "$method" "${BASE}${path}" -H "Api-Key: ${RAIN_API_KEY}"
  fi
}

echo "== Rain sandbox lifecycle simulation =="
echo "   base=${BASE}  card=${CARD_ID}  flow=${FLOW}"
echo

# 1) Create an authorization. Amounts are integer cents. merchantCategoryCode is an MCC.
authorize() {
  local amount="$1" decline_reason="${2:-}"
  local body
  if [[ -n "$decline_reason" ]]; then
    body=$(jq -nc --arg c "$CARD_ID" --argjson a "$amount" --arg d "$decline_reason" \
      '{cardId:$c, amount:$a, currency:"USD", merchantName:"Sim Merchant", merchantCategoryCode:"5812", declineReason:$d}')
  else
    body=$(jq -nc --arg c "$CARD_ID" --argjson a "$amount" \
      '{cardId:$c, amount:$a, currency:"USD", merchantName:"Sim Merchant", merchantCategoryCode:"5812"}')
  fi
  api POST "/simulate/transactions/authorize" "$body"
}

case "$FLOW" in
  standard)
    echo "-> authorize \$100.00 (10000c)"
    RESP=$(authorize 10000)
    echo "$RESP" | jq .
    TXN=$(echo "$RESP" | jq -r '.transactionId')
    echo "   (fires transaction.requested + transaction.created; ignore requested)"
    echo
    echo "-> settle (omit amount -> settles full auth)"
    api POST "/simulate/transactions/${TXN}/settle" '{}' | jq .
    echo "   (fires transaction.completed, completionReason settlement)"
    ;;

  incremental)
    echo "-> authorize \$50.00 (5000c)"
    RESP=$(authorize 5000); echo "$RESP" | jq .
    TXN=$(echo "$RESP" | jq -r '.transactionId')
    echo
    echo "-> increment to NEW TOTAL \$75.00 (7500c)"
    api PATCH "/simulate/transactions/${TXN}/authorize" '{"amount":7500}' | jq .
    echo "   (fires transaction.updated; amount=new total, authorizationUpdateAmount=+2500)"
    echo
    echo "-> settle"
    api POST "/simulate/transactions/${TXN}/settle" '{}' | jq .
    ;;

  partial-reversal)
    echo "-> authorize \$100.00 (10000c)"
    RESP=$(authorize 10000); echo "$RESP" | jq .
    TXN=$(echo "$RESP" | jq -r '.transactionId')
    echo
    echo "-> reverse to remaining \$60.00 (newAmount=6000c)"
    api POST "/simulate/transactions/${TXN}/reverse" '{"newAmount":6000}' | jq .
    echo "   (fires transaction.updated status=reversed, amount=6000, delta=-4000; HOLD MAINTAINED)"
    ;;

  full-reversal)
    echo "-> authorize \$100.00 (10000c)"
    RESP=$(authorize 10000); echo "$RESP" | jq .
    TXN=$(echo "$RESP" | jq -r '.transactionId')
    echo
    echo "-> full reverse (omit newAmount)"
    api POST "/simulate/transactions/${TXN}/reverse" '{}' | jq .
    echo "   (fires transaction.updated status=reversed, amount=0; HOLD MAINTAINED)"
    ;;

  decline)
    echo "-> authorize \$250.00 (25000c) forced decline (card_spending_limit not in enum -> use card_locked)"
    RESP=$(authorize 25000 "card_locked"); echo "$RESP" | jq .
    echo "   (fires transaction.created status=declined; delivered declinedReason is lowercase space-separated)"
    ;;

  refund)
    echo "-> authorize \$100.00 (10000c) then settle"
    RESP=$(authorize 10000); echo "$RESP" | jq .
    TXN=$(echo "$RESP" | jq -r '.transactionId')
    api POST "/simulate/transactions/${TXN}/settle" '{}' | jq .
    echo
    echo "-> refund \$40.00 (4000c) of the settled txn"
    api POST "/simulate/transactions/${TXN}/refund" '{"amount":4000}' | jq .
    echo "   (fires transaction.completed, completionReason refund. HTTP response shows UPPER_CASE REFUND;"
    echo "    delivered webhook uses lowercase 'refund'.)"
    ;;

  *)
    echo "Unknown flow: $FLOW" >&2
    echo "Valid flows: standard | incremental | partial-reversal | full-reversal | decline | refund" >&2
    exit 2
    ;;
esac

echo
echo "Done. Watch your webhook receiver logs for the delivered events."
