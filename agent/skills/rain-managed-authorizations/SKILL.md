---
description: "Receive and process Rain card spend webhooks for Rain-Managed programs — stand up the webhook receiver, verify the HMAC-SHA256 `Signature` header against your API key, and handle the transaction lifecycle (standard, incremental, partial/full reversal, refund, stale-authorization closure, settlement) via `transaction.created`/`.updated`/`.completed`. TRIGGER when building a Rain webhook endpoint, verifying webhook signatures, reconciling spend/auth/settlement events, or debugging out-of-order/duplicate webhooks. Under Rain-Managed, Rain auto-decides — you CANNOT approve/decline at auth time. `transaction.requested` is NOT delivered in production under Rain-Managed (you will only see it in sandbox, where the simulator emits it for every program); treat `transaction.created` as the source of truth and never block on `requested`. SKIP if the user needs to CONTROL approve/decline in real time (respond 4xx + `rejectionCode`) — that is Partner-Managed and out of scope; for auth/SDK/idempotency/retries → `rain-api-auth`; for issuing the card → `rain-issue-consumer-card`."
---
# Rain — Managed Authorizations (spend webhooks)

Receive Rain card spend webhooks, verify their signatures, and reconcile the
transaction lifecycle for a **Rain-Managed** program. Under Rain-Managed, Rain
runs every authorization check itself — card validity, balance, spending
limits, custom merchant rules — places the fund hold, responds to the card
network, and *then* notifies you. **You observe; you do not decide.**

## ⚠️ You cannot approve or decline under Rain-Managed

This is the single most-missed fact for external integrators. Bake it in before
you write a line of handler code:

- Rain has **already responded to the card network** by the time any webhook
  reaches you. There is no real-time hook to approve or decline.
- The decision-point event, `transaction.requested`, is a **Partner-Managed-only**
  event. It is **not delivered in production under Rain-Managed**. Rain's docs
  gate it explicitly: *"Only Partner-managed programs can authorize or reject
  transactions. Rain-managed programs do not support this feature at this time."*
- In **sandbox** you *will* see an `action: "requested"` event, because the
  simulate API emits `requested` + `created` for every program regardless of
  mode. **Ignore it.** Do not build approve/decline logic around it; do not
  block your pipeline waiting for it. Treat `transaction.created` as the source
  of truth.
- If the user genuinely needs to control approve/decline in real time (respond
  `401`/`40X` with a `rejectionCode`), that is **Partner-Managed** — a different
  program type and out of scope for this skill.

Full comparison: [`references/rain-vs-partner-managed.md`](references/rain-vs-partner-managed.md).

## Rain-Managed vs Partner-Managed

| | **Rain-Managed** (this skill) | **Partner-Managed** (out of scope) |
|---|---|---|
| Who decides the auth | **Rain** (balance, limits, merchant rules) | **You**, in real time |
| `transaction.requested` delivered? | **No** (prod). Sandbox simulator emits it — ignore. | **Yes** — you must respond to it |
| How you decline | You can't | Respond `401`/`40X` + `rejectionCode` |
| First actionable event | `transaction.created` | `transaction.requested` |
| Your job | Verify, dedupe, reconcile, persist | Authorize/reject, then reconcile |
| `rejectionCode` field | N/A | Required when declining |

## The webhook envelope

Every webhook Rain sends is a JSON envelope with a stable shape. The transaction
payload lives under `body.spend`.

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "resource": "transaction",
  "action": "created",
  "version": "1.0.0",
  "eventReceivedAt": "2025-01-15T10:30:45.123Z",
  "body": {
    "id": "30dcf8c6-a1e5-48f1-9c40-ecffe8253d25",
    "type": "spend",
    "spend": { "amount": 10000, "currency": "USD", "status": "pending", "...": "..." }
  }
}
```

Two distinct ids — keep them straight:

| Field | Meaning | Use it for |
|---|---|---|
| `id` (envelope, top level) | Unique **delivery** id (UUID). Different on every delivery and every retry of the *same* event. | **Deduplication** — store processed envelope ids. |
| `body.id` | The **transaction** id. **Stable** across `created` → `updated` → `completed` for one transaction. | Correlation — join lifecycle events for the same charge. |

- `action`: `requested` (Partner-Managed / sandbox only), `created`, `updated`, `completed`.
- `version`: payload schema version (`1.0.0`, `1.1.0`, …). You control which
  version Rain sends per event pattern via `PUT /issuing/webhooks/configuration`
  (see Step 1).
- `eventReceivedAt`: **optional**, and **off by default for spend** — see Step 4.
- `body.type`: `spend` | `collateral` | `payment`. This skill covers `spend`.

Full field tables per action/version: [`references/webhook-payloads.md`](references/webhook-payloads.md).

## The lifecycle in one picture

```
   AUTH TIME (Rain decides, then notifies)              SETTLEMENT (days later)
   ─────────────────────────────────────                ───────────────────────
   Merchant → Rain: Auth request ($100)
   Rain checks balance/limits/rules
   Rain places hold, answers network "approved"
        │
        ▼
   transaction.created  status=pending  ($100)  ───────►  transaction.completed
        │                                                  status=completed
        ├─ incremental:  transaction.updated  ($125)       completionReason=settlement
        │                  amount = new total              ($100, postedAt set)
        ├─ partial rev.: transaction.updated  ($60)
        │                  status=reversed, hold MAINTAINED
        ├─ full rev.:    transaction.updated  ($0)
        │                  status=reversed, hold MAINTAINED
        └─ refund:       transaction.created  (-$100)      (or, if never settled:)
                           negative amount                 transaction.completed
                                                           completionReason=
                                                           stale_authorization_closure
```

Key truths the diagram encodes:

- **Reversals do NOT release the hold.** Rain keeps the hold until settlement
  (or 30 days) for fraud prevention. `amount` shrinks; the ledger hold does not.
- **`amount` on `updated` is the new TOTAL** authorized, not a delta. The delta
  is the separate, signed `authorizationUpdateAmount` field.
- **Refunds are `created` with a negative `amount`.** The ledger is not credited
  until the refund settles.
- **Settlement is a separate `completed` event**, possibly days later. Persist
  the `created` so you can reconcile against it.

Per-flow diagrams and exact webhook/status/field expectations:
[`references/transaction-lifecycle.md`](references/transaction-lifecycle.md).

## Prerequisites

- A Rain SDK client initialized (sandbox `'dev'` / prod `'production'`) and an
  API key. Set up auth, errors, retries, timeouts, and idempotency once in
  [`rain-api-auth`](../rain-api-auth/SKILL.md) — this skill assumes it.
- A card that has been issued and (for sandbox) activated. See
  [`rain-issue-consumer-card`](../rain-issue-consumer-card/SKILL.md).
- **Your API key value** — it doubles as your webhook signing secret (Step 2).

## Step 1 — Register your webhook URL (dashboard-first)

**URL registration is dashboard-only.** There is no API to create a delivery
URL — the spec exposes only `GET /issuing/webhooks` (a delivery *log*, not a
subscription list) and the version-config endpoints below. Add your receiving
URL in the **Rain developer dashboard**. Once configured, Rain delivers events
there.

**Your webhook URL must:**

- Use `http` or `https`.
- **Resolve to a public IP address.** Rain blocks URLs that resolve to private,
  internal, reserved, loopback (`127.0.0.1`), link-local (`169.254.x.x`), or
  cloud-metadata addresses. A non-conforming URL fails registration with
  `400 Bad Request`.

> **Local dev:** `localhost` is rejected. Tunnel your local receiver with a
> public URL — `ngrok http 3000` (or Cloudflare Tunnel / Tailscale Funnel) —
> and register the public `https://…` URL.

### Choose the payload version per event (optional, API-driven)

`PUT /issuing/webhooks/configuration` controls **which payload version** Rain
sends per event pattern. It does **not** set the delivery URL. Patterns are
`resource.action.version` or wildcards like `resource.*`; each value is
`{ "version": "<semver>" }`.

```bash
curl -X PUT "https://api-dev.raincards.xyz/v1/issuing/webhooks/configuration" \
  -H "Api-Key: $RAIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "transaction.created.*":   { "version": "1.1.0" },
        "transaction.updated.*":   { "version": "1.0.0" },
        "transaction.completed.*": { "version": "1.3.0" }
      }'
```

`PATCH` partially updates the map; set a pattern's value to `null` to remove it.
`GET` reads the current map. Pin the versions whose field tables you coded
against (see [`references/webhook-payloads.md`](references/webhook-payloads.md))
so a new default version can't silently change your payloads.

## Step 2 — Verify the `Signature` header (HMAC-SHA256)

Every webhook is signed. Verify **before** you process the body, and reject
anything that doesn't match. The scheme is identical to the one documented in
[`rain-api-auth`](../rain-api-auth/SKILL.md) — do not re-derive it here.

- **Algorithm:** HMAC-SHA256, output lowercase **hex**.
- **Secret:** your **API key value** (the full secret you copied at key
  creation). The API key *doubles* as the webhook signing secret — rotating the
  key rotates webhook signing too.
- **Header:** compare against `Signature`. During key rotation Rain may also
  send `Secondary-Signature` while both keys are valid — accept a match against
  **either**.
- **Compare in constant time** (`crypto.timingSafeEqual` / `hmac.compare_digest`
  / `hmac.Equal`) to avoid timing leaks.

> **⚠️ Sign over the RAW request body, not a re-serialized object.** Rain's
> documented example computes `HMAC(apiKey, JSON.stringify(payload))`, but signs
> *"the exact JSON payload sent in the body."* If you `JSON.parse` then
> re-`stringify`, key order / whitespace / number formatting can drift and the
> signature won't match. **Capture the raw body bytes exactly as received**
> (Express `express.raw()`, FastAPI `await request.body()`, Go `io.ReadAll`)
> and HMAC over those. This both matches "the exact payload" and is byte-stable.
> Only after verifying do you parse JSON.

The bundled verifiers do exactly this:

- [`scripts/verify-signature.js`](scripts/verify-signature.js)
- [`scripts/verify-signature.py`](scripts/verify-signature.py)
- [`scripts/verify-signature.go`](scripts/verify-signature.go)

Node sketch (the verifier scripts are the complete, drop-in versions):

```js
import { createHmac, timingSafeEqual } from "node:crypto";

// rawBody: Buffer | string exactly as received. apiKey: your API key value.
export function verifyRainSignature(rawBody, headers, apiKey) {
  const expected = createHmac("sha256", apiKey).update(rawBody).digest("hex");
  const expBuf = Buffer.from(expected, "hex");
  for (const h of ["signature", "secondary-signature"]) {
    const got = headers[h];
    if (!got) continue;
    const gotBuf = Buffer.from(got, "hex");
    if (gotBuf.length === expBuf.length && timingSafeEqual(gotBuf, expBuf)) return true;
  }
  return false;
}
```

## Step 3 — Acknowledge fast, process async

Rain treats a delivery as **failed** unless your endpoint returns a `2xx`
quickly. Slow handlers cause retries and duplicate processing.

- **Return `200` within a few seconds.** Do verification + dedupe + enqueue
  inline; do the heavy reconciliation work asynchronously (queue, background
  worker).
- **Respond with JSON.** Rain truncates non-JSON / HTML / plain-text responses
  and stores them as `{ "truncated": true, "contentType": …, "content": "…" }`.
  Return `{ "received": true }`, not an HTML error page.
- A `transaction.completed` (settlement) event requires **no response action**
  beyond the `200` ack.

## Step 4 — Idempotency & ordering

Webhooks can arrive **more than once** and **out of order**. Handle both.

**Idempotency — dedupe on the envelope `id`.** Store processed envelope ids and
skip duplicates before doing any work. (Retries reuse the same event but you
should treat the envelope `id` as the dedupe key per Rain's guidance.)

**Ordering — `eventReceivedAt`, OFF by default for spend.**

- `eventReceivedAt` is when Rain first received the underlying event. Use it to
  order events for the same `body.id` (e.g. a late `created` arriving after its
  `updated`).
- It is **optional and excluded from spend payloads by default.** To get it,
  **contact your Rain account manager to enable it for your tenant.** Until
  then, you cannot rely on it for spend — design so that out-of-order arrival is
  tolerated (e.g. upsert by `body.id`, apply `completed` as terminal).
- When present: parse as UTC (`Z` suffix), and allow a **30–60s buffer** for
  late arrivals before treating an ordering as final.

**Retry behavior (so you can reason about duplicates):** a failed delivery is
retried **15 times** with exponential backoff for up to **one week** — first
retry at **2.5s**, coefficient **3** (2.5s → 7.5s → 22.5s → …), capped at **one
day** between retries. A delivery fails if you don't return `2xx`, time out, or
are unreachable.

## Step 5 — Handle the lifecycle

Route on `action` + `body.spend.status` + (for `completed`) `completionReason`.
Each flow below names the exact webhook, status, and the fields you must read.
Full diagrams + field-by-field expectations:
[`references/transaction-lifecycle.md`](references/transaction-lifecycle.md).

### Standard authorization
- **Event:** `transaction.created`, `status: "pending"`.
- Persist it. The matching `transaction.completed` (`completionReason:
  settlement`) arrives later at settlement.

### Declined authorization
- **Event:** `transaction.created`, `status: "declined"`, with `declinedReason`.
- You **cannot** prevent this (Rain decided). **Persist for logging.** Match
  `declinedReason` against the standard list; treat anything unrecognized as a
  generic decline — see [`references/decline-reasons.md`](references/decline-reasons.md).

### Incremental authorization
- **Events:** `transaction.created` (initial), then `transaction.updated` with
  the **new total** (`amount` = original + increment) and a **positive**
  `authorizationUpdateAmount`.

### Partial reversal
- **Event:** `transaction.updated`, `status: "reversed"`. `amount` = new reduced
  total; `authorizationUpdateAmount` is **negative**. **The hold is maintained**
  until settlement — do not release funds on your side.

### Full reversal
- **Event:** `transaction.updated`, `status: "reversed"`, `amount: 0`. Hold not
  released until settlement or after 30 days.

### Refund (negative amount)
- **Event:** `transaction.created` with a **negative `amount`**. The user's
  ledger is **not credited until the refund settles** — do not credit early.

### Partial authorization — not supported
- Insufficient funds for the full amount ⇒ **declined**, not partially approved.
  You get `transaction.created`, `status: "declined"`.

### Stale-authorization closure
- **Event:** `transaction.completed`, `completionReason:
  "stale_authorization_closure"` (delivered "if configured"). Held funds are
  released to available balance and the transaction is marked complete.
- **Thresholds (Rain-Managed):** standard transactions **under $1,000** close
  after **14 days** with no settlement; **$1,000 or more**, and credits /
  reversals, close after **31 days**.
- If the merchant later settles a closed transaction, it is processed as a new
  charge — surfaced as a force-posted `completed`
  (`isForcePosted: true`, `closedAuthorizationTransactionId`,
  `completionReason: "reprocessed_settlement"`).

### Settlement
- **Event:** `transaction.completed`, `status: "completed"`,
  `completionReason: "settlement"`, with `postedAt` set. `amount` = final
  settled amount (may differ from the authorized amount). No response required.

## Payload field reference

Per-action, per-version field tables (created / updated / completed, with the
`completionReason` enum and the v1.2.0 force-post fields):
[`references/webhook-payloads.md`](references/webhook-payloads.md).

## Decline reasons

Standard `declinedReason` enum + the processor-originated, free-form reasons you
must **not** branch on: [`references/decline-reasons.md`](references/decline-reasons.md).

## Runnable examples

- **Receivers** — verify → dedupe on `id` → order by `eventReceivedAt` → route
  by `action` → `200` fast:
  [`examples/webhook-receiver.ts`](examples/webhook-receiver.ts),
  [`examples/webhook-receiver.py`](examples/webhook-receiver.py),
  [`examples/webhook-receiver.go`](examples/webhook-receiver.go).
- **Sample payloads** (one per flow) to test your receiver offline:
  [`examples/payloads/`](examples/payloads/).
- **Drive the lifecycle in sandbox** end-to-end with the simulate API:
  [`examples/simulate-lifecycle.sh`](examples/simulate-lifecycle.sh).

## Sandbox testing

- Register your receiver via a **public tunnel** (loopback is blocked).
- **Fund collateral and have an active card first** — you need a usable balance
  and an `active` card (`locked`/`canceled`/`unactivated` cards can't be
  simulated against). Use `POST /simulate/collateral/fund`.
- Drive events with the **beta simulate API** (dev only; prod returns `404`):
  `POST /simulate/transactions/authorize`, then
  `PATCH /…/{id}/authorize` (increment), `POST /…/{id}/reverse`,
  `POST /…/{id}/settle`, `POST /…/{id}/refund`. The script
  [`examples/simulate-lifecycle.sh`](examples/simulate-lifecycle.sh) wires these
  together.
- Expect a `transaction.requested` in sandbox — **ignore it** (Rain-Managed
  acts only on `created`). The simulate API emits `requested` + `created` for
  every program.
- Note: the simulate HTTP *response* uses UPPER_CASE (`SETTLEMENT`, `REFUND`)
  and a snake_case `declineReason` enum; the delivered **webhook** payload uses
  the lowercase enums in the references. Don't conflate the two.

## Go-live checklist

- [ ] Receiver verifies the `Signature` (and `Secondary-Signature`) over the
  **raw body** with **constant-time** compare, against the **production**
  signing key.
- [ ] Returns `200` JSON within a few seconds; heavy work is async.
- [ ] **Idempotent** — dedupe on the envelope `id`; the same event can arrive 15×.
- [ ] Tolerates **out-of-order** delivery (upsert by `body.id`; `completed` is
  terminal). If you depend on `eventReceivedAt`, confirm your account manager
  **enabled it for spend**.
- [ ] Persists **every** `transaction.created` (incl. declines) so you can
  reconcile `updated`/`completed` against it.
- [ ] Treats reversals as hold-maintained; does not credit refunds before they
  settle.
- [ ] Production webhook URL registered in the dashboard; key rotation done via
  `POST /issuing/webhooks/apikey/secondary` → `…/promote`.
- [ ] No approve/decline logic — that's Partner-Managed.

## See also

- [`rain-api-auth`](../rain-api-auth/SKILL.md) — SDK setup, error handling,
  retries, timeouts, idempotency, and the canonical HMAC-SHA256 **signature
  verification** reference this skill builds on.
- [`rain-issue-consumer-card`](../rain-issue-consumer-card/SKILL.md) — issue and
  activate the card whose spend you receive here.
- [`rain-api-generic`](../rain-api-generic/SKILL.md) — any Rain endpoint not
  covered by a specific skill (balances, transfers, disputes, simulate).
- [`references/rain-vs-partner-managed.md`](references/rain-vs-partner-managed.md)
- [`references/transaction-lifecycle.md`](references/transaction-lifecycle.md)
- [`references/webhook-payloads.md`](references/webhook-payloads.md)
- [`references/decline-reasons.md`](references/decline-reasons.md)
