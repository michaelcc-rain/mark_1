// webhook-receiver.go — runnable Rain spend-webhook receiver (net/http).
//
// Pipeline: verify signature -> dedupe on envelope id -> order by eventReceivedAt
//
//	-> route by action -> return 200 FAST (heavy work goes async).
//
// Run:
//
//	RAIN_API_KEY=sk_dev_... go run webhook-receiver.go
//	# expose publicly (loopback is blocked by Rain): ngrok http 3000
//	# register the ngrok https URL in the Rain developer dashboard.
//
// Rain-Managed: you CANNOT approve/decline. transaction.requested only shows up
// in sandbox — this receiver ignores it. transaction.created is the truth.
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Payload types (subset — see references/webhook-payloads.md for full tables).
// ---------------------------------------------------------------------------
type Envelope struct {
	ID              string `json:"id"` // delivery id (UUID) — DEDUPE KEY
	Resource        string `json:"resource"`
	Action          string `json:"action"` // requested | created | updated | completed
	Version         string `json:"version"`
	EventReceivedAt string `json:"eventReceivedAt"` // optional; OFF by default for spend
	Body            struct {
		ID    string `json:"id"`   // transaction id — STABLE across the lifecycle
		Type  string `json:"type"` // spend | collateral | payment
		Spend *Spend `json:"spend"`
	} `json:"body"`
}

type Spend struct {
	Amount                           int64  `json:"amount"` // integer cents; negative for refunds
	Currency                         string `json:"currency"`
	Status                           string `json:"status"` // pending | reversed | declined | completed
	DeclinedReason                   string `json:"declinedReason"`
	AuthorizationUpdateAmount        int64  `json:"authorizationUpdateAmount"` // signed
	CompletionReason                 string `json:"completionReason"`
	CardID                           string `json:"cardId"`
	UserID                           string `json:"userId"`
	MerchantName                     string `json:"merchantName"`
	PostedAt                         string `json:"postedAt"`
	IsForcePosted                    bool   `json:"isForcePosted"`
	ClosedAuthorizationTransactionID string `json:"closedAuthorizationTransactionId"`
}

var apiKey = os.Getenv("RAIN_API_KEY") // doubles as the webhook signing secret

// In-memory stores — swap for Redis / your DB in production.
var (
	mu                sync.Mutex
	processedDelivery = map[string]struct{}{} // envelope id -> handled
	lastEventMsByTxn  = map[string]int64{}    // body.id -> latest eventReceivedAt (ms)
)

// ---------------------------------------------------------------------------
// Step 2 — signature verification (raw body, constant-time, secondary fallback).
// Mirrors scripts/verify-signature.go and the rain-api-auth scheme.
// ---------------------------------------------------------------------------
func verifyRainSignature(rawBody []byte, h http.Header, key string) bool {
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write(rawBody)
	expected := mac.Sum(nil)
	for _, name := range []string{"Signature", "Secondary-Signature"} {
		provided := h.Get(name)
		if provided == "" {
			continue
		}
		raw, err := hex.DecodeString(provided)
		if err != nil {
			continue
		}
		if hmac.Equal(raw, expected) { // constant-time
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Step 4 — idempotency + ordering helpers.
// ---------------------------------------------------------------------------
func alreadyProcessed(deliveryID string) bool {
	mu.Lock()
	defer mu.Unlock()
	if _, ok := processedDelivery[deliveryID]; ok {
		return true
	}
	processedDelivery[deliveryID] = struct{}{}
	return false
}

// isInOrder reports false if this event is OLDER than one already applied for
// the same txn. Only meaningful when eventReceivedAt is present — it is OFF by
// default for spend (enable via your account manager). Without it, make handlers
// order-tolerant (upsert by body.id; completed is terminal).
func isInOrder(txnID, eventReceivedAt string) bool {
	if eventReceivedAt == "" {
		return true
	}
	t, err := time.Parse(time.RFC3339Nano, eventReceivedAt)
	if err != nil {
		return true
	}
	ms := t.UTC().UnixMilli()
	mu.Lock()
	defer mu.Unlock()
	if last, ok := lastEventMsByTxn[txnID]; ok && ms < last {
		return false
	}
	lastEventMsByTxn[txnID] = ms
	return true
}

// ---------------------------------------------------------------------------
// Step 5 — routing. Enqueue real work; keep the handler fast.
// ---------------------------------------------------------------------------
func routeEvent(env Envelope) {
	if env.Body.Type != "spend" || env.Body.Spend == nil {
		return
	}
	s := env.Body.Spend
	txn := env.Body.ID

	switch env.Action {
	case "requested":
		// Rain-Managed: NOT delivered in production. Sandbox-only artifact. Ignore.
		log.Printf("[ignore] requested (sandbox artifact) txn=%s", txn)
	case "created":
		switch {
		case s.Status == "declined":
			log.Printf("[declined] txn=%s reason=%q", txn, s.DeclinedReason)
		case s.Amount < 0:
			log.Printf("[refund-auth] txn=%s amount=%d (no credit until settled)", txn, s.Amount)
		default:
			log.Printf("[auth] txn=%s amount=%d %s merchant=%q", txn, s.Amount, s.Currency, s.MerchantName)
		}
		// PERSIST every created (incl. declines) so updated/completed can reconcile.
	case "updated":
		switch {
		case s.Status == "reversed":
			kind := "partial"
			if s.Amount == 0 {
				kind = "full"
			}
			log.Printf("[reversal:%s] txn=%s newTotal=%d delta=%d (hold MAINTAINED)", kind, txn, s.Amount, s.AuthorizationUpdateAmount)
		case s.Status == "declined":
			log.Printf("[declined-after-auth] txn=%s reason=%q", txn, s.DeclinedReason)
		default:
			log.Printf("[incremental] txn=%s newTotal=%d delta=%d", txn, s.Amount, s.AuthorizationUpdateAmount)
		}
	case "completed":
		log.Printf("[completed] txn=%s settled=%d reason=%s postedAt=%s", txn, s.Amount, s.CompletionReason, s.PostedAt)
		if s.IsForcePosted {
			log.Printf("  force-posted; closedAuth=%s", s.ClosedAuthorizationTransactionID)
		}
	}
}

// ---------------------------------------------------------------------------
// The endpoint.
// ---------------------------------------------------------------------------
func handler(w http.ResponseWriter, r *http.Request) {
	rawBody, err := io.ReadAll(r.Body) // raw bytes — verify before parsing
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "cannot read body"})
		return
	}

	// Step 2: verify before doing anything.
	if !verifyRainSignature(rawBody, r.Header, apiKey) {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "invalid signature"})
		return
	}

	var env Envelope
	if err := json.Unmarshal(rawBody, &env); err != nil { // parse AFTER verifying
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON"})
		return
	}

	// Step 4: dedupe on the envelope delivery id.
	if alreadyProcessed(env.ID) {
		writeJSON(w, http.StatusOK, map[string]any{"received": true, "duplicate": true})
		return
	}

	// Step 4: drop stale out-of-order events (when eventReceivedAt is present).
	if !isInOrder(env.Body.ID, env.EventReceivedAt) {
		writeJSON(w, http.StatusOK, map[string]any{"received": true, "stale": true})
		return
	}

	// Step 5: process async; ack fast.
	go routeEvent(env)

	// Step 3: ack fast with JSON (never HTML — Rain truncates non-JSON responses).
	writeJSON(w, http.StatusOK, map[string]any{"received": true})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func main() {
	if apiKey == "" {
		log.Fatal("Set RAIN_API_KEY (your API key value = webhook signing secret).")
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	http.HandleFunc("/webhooks/rain", handler)
	log.Printf("Rain webhook receiver listening on :%s/webhooks/rain", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
