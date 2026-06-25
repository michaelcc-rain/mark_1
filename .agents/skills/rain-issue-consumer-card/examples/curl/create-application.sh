#!/usr/bin/env bash
# Create a Rain consumer KYC application.
# Requires: RAIN_API_KEY (sandbox). Base URL is sandbox; swap to api.raincards.xyz for prod.
#
#   ./create-application.sh            # full-PII variant (default)
#   ./create-application.sh sumsub     # Sumsub share-token variant
#   ./create-application.sh persona    # Persona share-token variant
#
# The returned `id` is the userId for document upload and card creation.
set -euo pipefail

: "${RAIN_API_KEY:?set RAIN_API_KEY (sandbox)}"
BASE="${RAIN_BASE_URL:-https://api-dev.raincards.xyz/v1}"
VARIANT="${1:-full}"

# Common required fields (apply to ALL variants): ipAddress, occupation, annualSalary,
# accountPurpose, expectedMonthlyVolume. isTermsOfServiceAccepted recommended (must be true).
COMMON='"ipAddress":"203.0.113.10","occupation":"15-1252","annualSalary":"50000-100000","accountPurpose":"web3Payments","expectedMonthlyVolume":"1000-5000","isTermsOfServiceAccepted":true,"walletAddress":"0x1234567890abcdef1234567890abcdef12345678"'

case "$VARIANT" in
  sumsub)
    # Variant 2: Sumsub share token. sumsubShareTokenMode is optional
    # (reusableKyc | sumsubIdConnect | copyApplicant).
    BODY="{${COMMON},\"sumsubShareToken\":\"_act-sbx-REPLACE_ME\",\"sumsubShareTokenMode\":\"reusableKyc\"}"
    ;;
  persona)
    # Variant 3: Persona share token (the Persona inquiry ID).
    BODY="{${COMMON},\"personaShareToken\":\"inq_REPLACE_ME\"}"
    ;;
  *)
    # Variant 1: full PII. Sandbox: lastName contains "approved" -> auto-approve.
    BODY="{${COMMON},\"firstName\":\"Jane\",\"lastName\":\"Doe approved\",\"birthDate\":\"1990-04-15\",\"nationalId\":\"123456789\",\"countryOfIssue\":\"US\",\"email\":\"jane.doe.$(date +%s)@example.com\",\"phoneCountryCode\":\"1\",\"phoneNumber\":\"5125550100\",\"address\":{\"line1\":\"123 Main St\",\"city\":\"New York\",\"region\":\"NY\",\"postalCode\":\"10001\",\"countryCode\":\"US\"}}"
    ;;
esac

curl -sS -X POST "${BASE}/issuing/applications/user" \
  -H "Api-Key: ${RAIN_API_KEY}" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d "${BODY}"
