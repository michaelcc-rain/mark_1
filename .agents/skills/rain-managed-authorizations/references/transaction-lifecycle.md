# Rain transaction lifecycle (Rain-Managed)

Every flow Rain-Managed produces, with the exact webhook(s) it fires, the
`status` / `completionReason` you'll see, the fields you must read, and an ASCII
diagram per flow.

> All amounts in **webhook payloads are integer cents** (USD minor units).
> Diagrams show dollars for readability. Diagrams are adapted from the
> Rain-Managed authorization docs.

## Table of contents

- [Mental model](#mental-model)
- [Standard authorization](#standard-authorization)
- [Declined authorization](#declined-authorization)
- [Incremental authorization](#incremental-authorization)
- [Partial reversal](#partial-reversal)
- [Full reversal](#full-reversal)
- [Refund (negative amount)](#refund-negative-amount)
- [Partial authorization — not supported](#partial-authorization--not-supported)
- [Stale-authorization closure](#stale-authorization-closure)
- [Settlement](#settlement)
- [Force-posted settlements](#force-posted-settlements)
- [Routing cheat-sheet](#routing-cheat-sheet)

## Mental model

- **Auth time** produces `transaction.created` (and possibly `transaction.updated`).
  Rain places a **hold** on collateral. The hold is **not** the final charge.
- **Settlement** produces `transaction.completed`, often **days** later, when the
  merchant submits the real charge. `amount` then is the **final settled amount**
  and may differ from what was authorized.
- `body.id` (the transaction id) is **stable** across `created` → `updated` →
  `completed`. Correlate on it. The envelope `id` changes per delivery.
- **Reversals shrink `amount` but do NOT release the hold** before settlement
  (or 30 days) — Rain holds for fraud prevention.
- **`amount` on `updated` is the new TOTAL**, not a delta. The delta is the
  signed `authorizationUpdateAmount` (negative = reversal/decrease, positive =
  increment).

## Standard authorization

A normal card purchase that Rain approves.

```
Merchant → Rain     Auth Request ($100)
Rain → Ledger       Check Balance → Sufficient
Rain → Ledger       Place Hold ($100)        Note: Total Hold ($100)
Rain → Merchant     Auth Approved
Rain → YOU          transaction.created  ($100)
YOU → Rain          Webhook Acknowledged (200)
```

- **Webhook:** `transaction.created`
- **`spend.status`:** `pending`
- **Read:** `body.id`, `spend.amount`, `spend.cardId`, `spend.userId`,
  `spend.merchantName`, `spend.authorizedAt`.
- **Then:** persist; await the matching `transaction.completed` at settlement.

## Declined authorization

Rain rejected the auth (failed rule, locked card, insufficient funds, etc.). You
**could not have prevented this** — Rain decided.

- **Webhook:** `transaction.created`
- **`spend.status`:** `declined`
- **Read:** `spend.declinedReason` (match the standard list, else treat as
  generic decline — see [`decline-reasons.md`](decline-reasons.md)).
- **Then:** persist for logging. No further events follow for a declined auth.

## Incremental authorization

The merchant raises the authorized amount (e.g. a tab, a hotel folio, fuel).

```
                    Initial Auth ($50)
Rain → YOU          transaction.created  ($50)
                    Incremental Auth (+$25)
Rain → YOU          transaction.updated  ($75)    ← new TOTAL, not the +$25
```

- **Webhooks:** `transaction.created` (initial), then `transaction.updated`.
- **On `updated`:** `spend.amount` = original + increment (**new total**);
  `spend.authorizationUpdateAmount` = **+increment** (positive);
  `spend.status` = `pending`.

## Partial reversal

The merchant releases part of the authorized amount (e.g. a smaller final bill).

```
                    Original Auth ($100)        Note: Total Hold ($100)
                    Partial Reversal (-$40)
Rain → YOU          transaction.updated  ($60)   Note: Hold MAINTAINED ($100)
```

- **Webhook:** `transaction.updated`
- **`spend.status`:** `reversed`
- **`spend.amount`:** new reduced total (e.g. `6000` = $60).
- **`spend.authorizationUpdateAmount`:** **negative** (e.g. `-4000`).
- **⚠️ The hold is MAINTAINED until settlement** — Rain records the reversed
  amount but does not reduce the hold (fraud prevention). Do **not** release
  funds on your side based on the reduced `amount`.

> Sample (from Rain docs): `amount` reduced `10000` → `8000` with
> `status: "reversed"` and `authorizationUpdateAmount: -2000` (a -$20.00
> adjustment).

## Full reversal

The merchant voids the entire authorization.

```
                    Original Auth ($100)        Note: Total Hold ($100)
                    Full Reversal (-$100)
Rain → YOU          transaction.updated  ($0)   Note: Hold MAINTAINED ($100)
```

- **Webhook:** `transaction.updated`
- **`spend.status`:** `reversed`
- **`spend.amount`:** `0`.
- **Hold not released** until settlement or **after 30 days**.

## Refund (negative amount)

A merchant-initiated credit back to the card. Looks like a standard
authorization but with a **negative amount**.

```
                    Auth Request (-$100)        Note: No Credit Hold
Rain → YOU          transaction.created  (-$100)
```

- **Webhook:** `transaction.created`
- **`spend.amount`:** **negative** (e.g. `-10000`).
- **⚠️ The user's ledger is NOT credited until the refund settles.** Do not
  credit the user early. A matching `transaction.completed`
  (`completionReason: refund`) follows at settlement.

## Partial authorization — not supported

When the cardholder has insufficient funds for the full requested amount, the
transaction is **declined** — Rain does not approve a partial amount.

- **Webhook:** `transaction.created`, `spend.status: "declined"`.

## Stale-authorization closure

An authorization that never settles is eventually closed; the held funds are
released to the available balance and the transaction is marked complete.

- **Webhook:** `transaction.completed` (delivered **"if configured"**).
- **`spend.completionReason`:** `stale_authorization_closure`.
- **Thresholds (Rain-Managed):**
  - Standard transactions **under $1,000** → closed after **14 days** with no
    settlement.
  - **$1,000 or more** → closed after **31 days**.
  - Credits and reversals → closed after **31 days**.
- **Effect:** held funds released to available balance; transaction marked
  complete.

> **Discrepancy to be aware of:** the Partner-Managed doc states the buckets
> slightly differently around the exact $1,000 boundary (`≤ $1000` → 14d vs
> `$1,000 or more` → 31d) and on refund/credit bucketing. For a Rain-Managed
> integration, use the Rain-Managed wording above; if you depend on the exact
> boundary at $1,000, confirm with your Rain account manager.

If the merchant later settles a transaction that was already closed, it is
processed as a **new charge** — see force-posted settlements below.

## Settlement

The merchant submits the real charge; the hold becomes a posted transaction.

- **Webhook:** `transaction.completed`
- **`spend.status`:** `completed`
- **`spend.completionReason`:** `settlement`
- **`spend.postedAt`:** settlement timestamp (ISO 8601).
- **`spend.amount`:** **final settled amount** (may differ from authorized;
  `spend.authorizedAmount` preserves the original).
- **No response required** beyond the `200` ack.

> `localAmount` / `localCurrency`: populated for foreign-currency settlement or
> when authorized == settled; may be absent on partial captures where
> authorized != settled.

## Force-posted settlements

A settlement that arrives **without a matching open authorization**, or for a
transaction that was already closed and settled. Surfaced on
`transaction.completed` (payload v1.2.0+):

- `spend.isForcePosted: true`
- `spend.closedAuthorizationTransactionId` — the auth txn id that was closed
  when this force-posted settlement arrived (present only when the force-post
  closed an existing, possibly stale, authorization).
- `spend.completionReason: "reprocessed_settlement"` for a replayed force-posted
  settlement.

Handle these as terminal `completed` events for the referenced transaction; if
you only ever stored the auth, reconcile via `closedAuthorizationTransactionId`.

## Routing cheat-sheet

Route on `action` → `status` → `completionReason`:

| `action` | `spend.status` | `spend.completionReason` | Flow | Hold |
|---|---|---|---|---|
| `created` | `pending` | — | Standard auth | placed |
| `created` | `pending` | — (negative `amount`) | Refund auth | none |
| `created` | `declined` | — | Declined (incl. partial-fund) | none |
| `updated` | `pending` | — (positive `authorizationUpdateAmount`) | Incremental | increased |
| `updated` | `reversed` | — (`amount` > 0) | Partial reversal | **maintained** |
| `updated` | `reversed` | — (`amount` = 0) | Full reversal | **maintained** |
| `updated` | `declined` | — | Declined after initial approval | released |
| `completed` | `completed` | `settlement` | Settlement | posted |
| `completed` | `completed` | `stale_authorization_closure` | Stale closure | released |
| `completed` | `completed` | `authorization_reversal` | Reversed to zero, closed | released |
| `completed` | `completed` | `refund` | Refund settled | — |
| `completed` | `completed` | `chargeback` | Charged back | — |
| `completed` | `completed` | `manual_closure` | Admin closed | released |
| `completed` | `completed` | `reprocessed_settlement` | Force-posted replay | posted |

`requested` is **not** in this table — it is Partner-Managed / sandbox-only and
Rain-Managed integrators ignore it (see
[`rain-vs-partner-managed.md`](rain-vs-partner-managed.md)).
