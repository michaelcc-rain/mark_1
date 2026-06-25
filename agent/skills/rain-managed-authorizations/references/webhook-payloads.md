# Spend webhook payload reference (by action & version)

Field tables for the spend webhook envelope and its three actionable payloads —
`transaction.created`, `transaction.updated`, `transaction.completed` — versioned
exactly as Rain's changelog defines them.

Pin the version you code against via `PUT /issuing/webhooks/configuration` (see
the main SKILL.md, Step 1) so a new default version can't silently change your
payloads.

## Table of contents

- [Envelope](#envelope)
- [`transaction.created` (spend)](#transactioncreated-spend)
- [`transaction.updated` (spend)](#transactionupdated-spend)
- [`transaction.completed` (spend)](#transactioncompleted-spend)
- [`completionReason` enum (all values)](#completionreason-enum-all-values)
- [Fields seen in real payloads but not in the changelog](#fields-seen-in-real-payloads-but-not-in-the-changelog)
- [Sandbox vs webhook enum casing](#sandbox-vs-webhook-enum-casing)

## Envelope

Top-level shape for every webhook (same for created / updated / completed):

| Field | Type | Notes |
|---|---|---|
| `id` | string (UUID) | **Delivery** id. Unique per delivery and per retry. **Dedupe key.** |
| `resource` | string | `transaction` for spend events. |
| `action` | string | `requested` \| `created` \| `updated` \| `completed`. (`requested` = Partner-Managed / sandbox only.) |
| `version` | string | Payload schema version, e.g. `1.0.0`. |
| `eventReceivedAt` | string (ISO 8601, optional) | When Rain first received the underlying event. **Off by default for spend** — enable per-tenant via your account manager. Parse as UTC. |
| `body` | object | The payload. |
| `body.id` | string | **Transaction** id. **Stable** across the lifecycle. Correlate on this. |
| `body.type` | string | `spend` \| `collateral` \| `payment`. This reference covers `spend`. |
| `body.spend` | object | Present when `body.type == "spend"`. Fields below. |

All monetary fields are **integer cents** (USD minor units).

## `transaction.created` (spend)

Fired when a card authorization is received — `pending` or `declined`. Also the
event for **refunds** (negative `amount`).

### v1.0.0

| Field | Type | Notes |
|---|---|---|
| `id` | string | Transaction id (== `body.id`). |
| `type` | string | Always `spend`. |
| `spend.amount` | number | Amount in cents. **Negative for refunds.** |
| `spend.currency` | string | e.g. `USD`. |
| `spend.localAmount` | number (optional) | Local-currency amount (cents). |
| `spend.localCurrency` | string (optional) | Local currency code. |
| `spend.authorizedAmount` | number (optional) | Authorized amount. |
| `spend.authorizationMethod` | string (optional) | Method of authorization. |
| `spend.merchantName` | string | |
| `spend.merchantCity` | string | |
| `spend.merchantCountry` | string | |
| `spend.merchantCategory` | string | Category description. |
| `spend.merchantCategoryCode` | string | MCC. |
| `spend.merchantId` | string (optional) | |
| `spend.cardId` | string | |
| `spend.cardType` | string | `virtual` \| `physical`. |
| `spend.companyId` | string (optional) | Corporate cards. |
| `spend.userId` | string | |
| `spend.userFirstName` | string | |
| `spend.userLastName` | string (optional) | |
| `spend.userEmail` | string | |
| `spend.status` | string | **enum: `pending` \| `declined`.** |
| `spend.declinedReason` | string (optional) | Present only when `status: declined`. See [`decline-reasons.md`](decline-reasons.md). |
| `spend.authorizedAt` | string | ISO 8601. |
| `spend.signature` | string (optional) | |
| `spend.timestamp` | number (optional) | Unix. |
| `spend.exchangeRate` | number (optional) | FX rate local→USD; present on international txns. |
| `spend.iso8583.de41` | string (optional) | Terminal ID (ISO 8583 DE41). |

### v1.1.0 adds

| Field | Type | Notes |
|---|---|---|
| `spend.threeDSecure` | boolean (optional) | Whether 3D Secure was used. |

## `transaction.updated` (spend)

Fired when an authorization is reversed, the amount changes (increment), or the
transaction is declined after initial approval.

### v1.0.0

Base fields mirror `created`, **plus**:

| Field | Type | Notes |
|---|---|---|
| `spend.authorizationUpdateAmount` | number (optional) | The amount by which the authorization changed. **Signed:** negative = reversal/decrease, positive = increment. |
| `spend.status` | string | **enum: `pending` \| `reversed` \| `declined`.** |
| `spend.declinedReason` | string (optional) | Only when `status: declined`. |

**`status` meanings:**

| Value | Meaning |
|---|---|
| `pending` | Still pending settlement (e.g. after an increment). |
| `reversed` | Authorization was reversed (voided by merchant — partial or full). |
| `declined` | Declined after initial authorization. |

**Important:** `spend.amount` on an `updated` event is the **new total
authorized amount**, not the delta. The delta is `authorizationUpdateAmount`.

## `transaction.completed` (spend)

Fired when a transaction is settled or otherwise closed. No response required.

### v1.0.0 (base)

| Field | Type | Notes |
|---|---|---|
| `id` | string | Transaction id. |
| `type` | string | `spend`. |
| `spend.amount` | number | **Final settled amount** (cents). May differ from authorized. |
| `spend.currency` | string | |
| `spend.localAmount` | number (optional) | |
| `spend.localCurrency` | string (optional) | |
| `spend.authorizedAmount` | number (optional) | The original authorized amount. |
| `spend.authorizationMethod` | string (optional) | |
| `spend.merchantName` / `merchantCity` / `merchantCountry` / `merchantCategory` / `merchantCategoryCode` | string | |
| `spend.merchantId` | string (optional) | |
| `spend.cardId` | string | |
| `spend.cardType` | string | `virtual` \| `physical`. |
| `spend.companyId` | string (optional) | |
| `spend.userId` / `userFirstName` / `userEmail` | string | |
| `spend.userLastName` | string (optional) | |
| `spend.status` | string | **Always `completed`.** |
| `spend.authorizedAt` | string | Original auth time (ISO 8601). |
| `spend.postedAt` | string | Settlement time (ISO 8601). |
| `spend.signature` | string (optional) | |
| `spend.timestamp` | number (optional) | |
| `spend.exchangeRate` | number (optional) | |

### v1.1.0 adds

| Field | Type | Notes |
|---|---|---|
| `spend.completionReason` | string (optional) | Why the transaction completed. **Full enum below.** |

### v1.2.0 adds (force-post)

| Field | Type | Notes |
|---|---|---|
| `spend.isForcePosted` | boolean (optional) | `true` = settlement arrived without a matching open auth, OR a new settlement arrived for a txn already closed+settled. Present only when explicitly set. |
| `spend.closedAuthorizationTransactionId` | string (optional) | Id of the auth txn closed when this force-posted settlement arrived. Present only when the force-post closed an existing (possibly stale) authorization. |

### v1.3.0 adds

| Field | Type | Notes |
|---|---|---|
| `spend.threeDSecure` | boolean (optional) | Whether 3D Secure was used. |

## `completionReason` enum (all values)

Delivered on `transaction.completed` v1.1.0+ (lowercase):

| Value | Description |
|---|---|
| `settlement` | Normal settlement from the payment network. |
| `stale_authorization_closure` | Authorization expired due to age without settlement. |
| `authorization_reversal` | Merchant fully reversed the authorization amount to zero. |
| `refund` | Transaction was refunded. |
| `chargeback` | Transaction was charged back. |
| `manual_closure` | Manually closed by an administrator. |
| `reprocessed_settlement` | Replayed force-posted settlement. |

## Fields seen in real payloads but not in the changelog

These appear in real sandbox payloads (`sample-webhooks.mdx`) but are not in the
changelog field tables. Treat the changelog as authoritative and these as
additional fields that may appear:

- `previouslyAuthorizedAmount` (number) — on `requested` (Partner-Managed).
- `enrichedMerchantName`, `enrichedMerchantCategory` — on `updated` / `completed`.
- `authorizationUpdateAmount` — on `updated` (now in the v1.0.0 `updated` table).

## Sandbox vs webhook enum casing

Do **not** confuse these — they are different surfaces:

| Surface | `completionReason` | decline reason field & casing |
|---|---|---|
| **Delivered webhook payload** | lowercase: `settlement`, `refund`, `stale_authorization_closure`, … | `declinedReason`, lowercase space-separated (e.g. `card locked`). |
| **Simulate API HTTP response** (not the webhook) | UPPER_CASE: `SETTLEMENT`, `REFUND` | `declineReason`, snake_case enum (e.g. `card_locked`) you *send in the request*. |

Your receiver parses the **delivered webhook** payload → use the lowercase enums.
The UPPER_CASE / snake_case forms only appear in the sandbox simulate API's
request body and HTTP response. See the main SKILL.md "Sandbox testing" section.
