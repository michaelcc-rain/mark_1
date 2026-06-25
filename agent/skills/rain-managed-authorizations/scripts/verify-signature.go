// verify-signature.go — verify a Rain webhook signature (HMAC-SHA256).
//
// Scheme (identical to rain-api-auth's signature-verification reference):
//
//	signature = hex( HMAC_SHA256(key = <YOUR_API_KEY_VALUE>, message = <RAW_REQUEST_BODY>) )
//
// IMPORTANT: HMAC over the RAW request body bytes EXACTLY as received — read the
// body with io.ReadAll BEFORE decoding JSON, and never re-marshal then sign.
// Re-serializing can reorder keys / change whitespace and break the match. The
// API key value doubles as the webhook signing secret; rotating the key rotates
// webhook signing too.
//
// Compares against the `Signature` header, falling back to `Secondary-Signature`
// (present during key rotation). Constant-time compare via hmac.Equal.
//
// Use VerifyRainSignature from your handler. A small CLI is included for testing
// against a saved payload:
//
//	RAIN_API_KEY=... go run verify-signature.go <payload.json> <signature-hex> [secondary-hex]
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
)

// VerifyRainSignature reports whether the Signature or Secondary-Signature
// header on h matches HMAC-SHA256(apiKey, rawBody).
//
// rawBody must be the raw request body EXACTLY as received (no re-serialization).
// apiKey is your Rain API key value (the webhook signing secret).
func VerifyRainSignature(rawBody []byte, h http.Header, apiKey string) bool {
	if apiKey == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(apiKey))
	mac.Write(rawBody)
	expected := mac.Sum(nil) // raw bytes; we compare decoded hex against this

	for _, name := range []string{"Signature", "Secondary-Signature"} {
		provided := h.Get(name)
		if provided == "" {
			continue
		}
		if constantTimeHexEqual(provided, expected) {
			return true
		}
	}
	return false
}

// constantTimeHexEqual decodes a hex signature and compares it to expected in
// constant time.
func constantTimeHexEqual(providedHex string, expected []byte) bool {
	provided, err := hex.DecodeString(providedHex)
	if err != nil {
		return false
	}
	// hmac.Equal is constant-time and safe for unequal lengths.
	return hmac.Equal(provided, expected)
}

// --- CLI -------------------------------------------------------------------
func main() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr,
			"Usage: RAIN_API_KEY=... go run verify-signature.go <payload.json> <signature-hex> [secondary-hex]")
		fmt.Fprintln(os.Stderr,
			"Tip: to GENERATE a signature for a sample payload, compute hex(HMAC_SHA256(apiKey, fileBytes)).")
		os.Exit(2)
	}
	apiKey := os.Getenv("RAIN_API_KEY")
	if apiKey == "" {
		fmt.Fprintln(os.Stderr, "Set RAIN_API_KEY (your API key value = webhook signing secret).")
		os.Exit(2)
	}

	rawBody, err := os.ReadFile(os.Args[1]) // raw bytes, no parse
	if err != nil {
		fmt.Fprintf(os.Stderr, "read payload: %v\n", err)
		os.Exit(2)
	}

	h := http.Header{}
	h.Set("Signature", os.Args[2])
	if len(os.Args) > 3 {
		h.Set("Secondary-Signature", os.Args[3])
	}

	if VerifyRainSignature(rawBody, h, apiKey) {
		fmt.Println("VALID — signature matches")
		os.Exit(0)
	}
	fmt.Println("INVALID — no matching signature")
	os.Exit(1)
}
