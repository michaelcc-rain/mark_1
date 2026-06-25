# Rain webhooks — HMAC-SHA256 signature verification

This is the **shared dependency** for
[`rain-managed-authorizations`](../../rain-managed-authorizations/SKILL.md):
verify that an inbound webhook actually came from Rain before you act on it.

> **Contents**
> - [The algorithm (exactly what Rain documents)](#the-algorithm-exactly-what-rain-documents)
> - [The dual-use key — your API key IS the signing secret](#the-dual-use-key)
> - [`Signature` and `Secondary-Signature` headers](#signature-and-secondary-signature-headers)
> - [⚠️ What bytes to sign — `JSON.stringify` vs raw body](#what-bytes-to-sign)
> - [Constant-time comparison (required)](#constant-time-comparison-required)
> - [Reference implementations (Node, Python)](#reference-implementations)
> - [Key rotation](#key-rotation)
> - [Triage: signature won't verify](#triage-signature-wont-verify)

## The algorithm (exactly what Rain documents)

Rain signs every webhook with **HMAC-SHA256**, where:

- **secret** = the **value of your API key** (the dual-use key, below),
- **message** = the JSON payload of the request body,
- **output** = **lowercase hex** digest,

and puts that digest in the `Signature` HTTP header. Rain's documented Node.js
example:

```ts
import { createHmac } from "crypto";

const signature = createHmac("sha256", YOUR_LATEST_API_KEY)
  .update(REQUEST_BODY_AS_JSON_STRING) // JSON.stringify(payload)
  .digest("hex");
```

> "Each webhook request is signed using an HMAC SHA256 signature, based on the
> exact JSON payload sent in the body. This signature is included in the
> `Signature` HTTP header." — Rain, *Webhooks overview*

Verify by recomputing this digest and comparing it (constant-time) to the
`Signature` header before processing the payload.

## The dual-use key

Rain uses **one of your tenant API keys** as the HMAC secret — "the same kind of
key you use in the `Api-Key` header for API requests. Use the **full key
value** (the secret you copied when that key was created)."

Consequences external integrators must internalize:

- **Your API key doubles as the webhook signing secret.** There is no separate
  "webhook secret" to copy. Whatever key is currently selected as the signing
  key is the HMAC secret.
- By default that is the tenant's **auto-generated `admin` key**. You can
  dedicate a `webhookSigning`-role key in the dashboard (API Settings) instead.
- **Rotating the API key rotates webhook signing.** If you revoke or replace the
  signing key, signatures computed with the old key stop matching. Use the
  rotation flow below so both keys are valid during cutover.

Store the signing key as, e.g., `RAIN_WEBHOOK_SIGNING_KEY` in your secret store.
If you never created a dedicated signing key, it is your default `admin`
`RAIN_API_KEY`.

## `Signature` and `Secondary-Signature` headers

| Header | Description |
|---|---|
| `Signature` | HMAC-SHA256 hex digest of the body, keyed by your latest API key. Verify against this. |
| `Secondary-Signature` | Optional. A second HMAC-SHA256 digest, present only during key rotation (or if configured for your account). |

Accept the webhook if **either** `Signature` **or** `Secondary-Signature`
matches your computed digest. During a rotation Rain signs with both the old and
new keys so you can cut over without dropping deliveries.

## What bytes to sign

⚠️ **This is the highest-risk correctness decision in the whole verifier.** Get
it wrong and *every* signature mismatches.

Rain's example reads `.update(JSON.stringify(payload))` — i.e. re-serialize a
parsed object. But the surrounding prose says the signature is "based on the
**exact JSON payload sent in the body**." Those two can disagree: if you
`JSON.parse()` the body and then `JSON.stringify()` it again, **key order,
whitespace, and number formatting may differ** from the exact bytes Rain hashed
— producing a false mismatch.

**Recommended default — hash the RAW body.** Capture the raw request body bytes
*exactly as received*, before any JSON parsing, and HMAC over those. This is
byte-stable and matches "the exact JSON payload sent in the body," so it works
regardless of how your JSON library would re-serialize the object. This is what
the production receivers and signature verifiers in
[`rain-managed-authorizations`](../../rain-managed-authorizations/SKILL.md) do —
capture with Express `express.raw({ type: 'application/json' })`, a `rawBody`
buffer, FastAPI `await request.body()`, or Go `io.ReadAll` — and it is the
scheme the two skills share.

> ⚠️ **Do not `JSON.parse` then re-`stringify` and sign that.** A re-serialized
> object whose key order / whitespace differs from the bytes Rain signed will
> fail verification. Only the literal `JSON.stringify(payload)` from Rain's docs
> matches *when* your serializer reproduces Rain's exact bytes — which you can't
> guarantee. Prefer the raw body.
>
> The bundled `verify-webhook.{js,py}` helpers below accept a body **string**:
> pass the **raw body string you received**, not `JSON.stringify(parsedObject)`.
> (They fall back to `JSON.stringify` only if handed an object, per Rain's literal
> example — avoid that path.)
>
> **Open item — confirm with the Rain platform team before going live.** The
> `JSON.stringify` example and the "exact bytes" prose are not fully reconciled
> in the public docs. The raw-body approach is the safe default; if a real
> delivery still fails to verify, raise it with Rain.

Either way: **never** call your business logic before a signature matches.

## Constant-time comparison (required)

Compare digests with a constant-time function (`crypto.timingSafeEqual`,
`hmac.compare_digest`, `hmac.Equal`) — never `===` / `==`. A naive comparison
leaks timing information that can let an attacker forge a signature byte by byte.
Both candidates must be the same length before comparing, or the function
throws.

## Reference implementations

Both ship in this skill and run with **no network** — feed them a sample payload
and the signing key.

- [`scripts/verify-webhook.js`](../scripts/verify-webhook.js)
- [`scripts/verify-webhook.py`](../scripts/verify-webhook.py)

### Node.js

```js
const { createHmac, timingSafeEqual } = require('node:crypto');

/**
 * @param {string} body   The webhook request body. Prefer the RAW string
 *                         exactly as received; this falls back to
 *                         JSON.stringify per Rain's documented example.
 * @param {string} signingKey  The API key value Rain uses to sign (dual-use).
 * @param {string} signature   The `Signature` header.
 * @param {string} [secondary] The `Secondary-Signature` header, if present.
 */
function verifyRainWebhook(body, signingKey, signature, secondary) {
  const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
  const expected = createHmac('sha256', signingKey).update(bodyString).digest('hex');
  return matches(expected, signature) || (secondary != null && matches(expected, secondary));
}

function matches(expectedHex, receivedHex) {
  if (typeof receivedHex !== 'string') return false;
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(receivedHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
```

### Python

```python
import hashlib
import hmac

def verify_rain_webhook(body: str, signing_key: str, signature: str,
                        secondary: str | None = None) -> bool:
    """body should be the RAW request body string as received."""
    expected = hmac.new(signing_key.encode(), body.encode(), hashlib.sha256).hexdigest()
    if hmac.compare_digest(expected, signature):
        return True
    return secondary is not None and hmac.compare_digest(expected, secondary)
```

### Go

```go
import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
)

// body should be the raw request body bytes as received.
func VerifyRainWebhook(body []byte, signingKey, signature, secondary string) bool {
	mac := hmac.New(sha256.New, []byte(signingKey))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature)) ||
		(secondary != "" && hmac.Equal([]byte(expected), []byte(secondary)))
}
```

(Go's `hmac.Equal` is constant-time over equal-length inputs.)

## Key rotation

Rotate the signing key without dropping deliveries:

1. `POST /issuing/webhooks/apikey/secondary` (`createSecondarySigningApiKey`).
   The response returns `newSecondarySigningApiKey.key` — **the actual key value,
   returned only once.** Capture and store it.
2. While both keys are valid, Rain may send a `Secondary-Signature` header.
   Verify against `Signature` **or** `Secondary-Signature` (the reference
   implementations above already do).
3. `POST /issuing/webhooks/apikey/secondary/promote`
   (`promoteSecondarySigningApiKey`) — promote the secondary to primary.
4. Update your stored signing key to the promoted value.

> To delete a key that is currently the primary or secondary signing key, set a
> *different* signing key first.

## Triage: signature won't verify

Walk these in order:

1. **Wrong secret.** You're hashing with a key that isn't the currently selected
   signing key. Default is the tenant `admin` key; confirm you didn't rotate it.
2. **Re-serialization mismatch.** You parsed then re-stringified the body and the
   bytes drifted. Switch to hashing the **raw body** (see
   [What bytes to sign](#what-bytes-to-sign)).
3. **Encoding.** Output must be **lowercase hex**, not base64. The secret is
   hashed as UTF-8 bytes of the key string.
4. **Comparing the wrong header.** During rotation the match may be on
   `Secondary-Signature`, not `Signature`.
5. **Whitespace in the key.** A trailing newline in the stored key changes the
   HMAC. Trim it.

## See also

- [`../SKILL.md`](../SKILL.md) — the dual-use callout and rotation endpoints.
- [`rain-managed-authorizations`](../../rain-managed-authorizations/SKILL.md) —
  the consumer of this verifier; the webhook envelope and lifecycle live there.
- [auth-pitfalls.md](auth-pitfalls.md#webhook-signing-key-pitfalls) — signing-key
  pitfalls.
