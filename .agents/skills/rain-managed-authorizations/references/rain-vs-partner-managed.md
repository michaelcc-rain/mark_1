# Rain-Managed vs Partner-Managed authorizations

The two program types differ in **one fundamental way**: who decides whether an
authorization is approved. Everything else follows from that.

This repo's `rain-managed-authorizations` skill covers **Rain-Managed only**.
If the user needs real-time approve/decline control, that is **Partner-Managed**
and out of scope.

## The core difference

| | **Rain-Managed** | **Partner-Managed** |
|---|---|---|
| Who decides the authorization | **Rain.** It verifies card validity, the user's balance, spending limits, and custom merchant rules, places the hold, and answers the network. | **You.** Rain forwards the request and waits for your decision. |
| Your real-time control | **None.** Rain has already answered the network before you get a webhook. | **Full.** You approve or decline each request. |
| `transaction.requested` delivered (production)? | **No.** | **Yes** — it is the event you respond to. |
| First event you can act on | `transaction.created` | `transaction.requested` |
| How you decline | You can't. | Respond to `transaction.requested` with `401` or any `40X`, body `{ "success": false, "rejectionCode": "<reason>" }`. |
| `rejectionCode` field | N/A | **Required** when declining (else Rain logs a general webhook decline). |
| Your responsibilities | Verify signature, dedupe, reconcile lifecycle, persist. | All of the above **plus** authorize/reject and place/manage the hold. |

Rain's docs state the gate verbatim:

> "Only Partner-managed programs can decline transactions / authorize or reject
> transactions. Rain-managed programs do not support this feature at this time."

## Why `transaction.requested` does NOT reach a production Rain-Managed client

1. The `requested` action is framed exclusively around Partner-Managed in the
   docs: *"Partner-managed programs need to put a hold on the collateral balance
   and to respond to this webhook to authorize the transaction."*
2. None of the Rain-Managed lifecycle diagrams contain a `transaction.requested`
   arrow — every Rain-Managed flow (standard, incremental, partial reversal,
   full reversal, refund) goes straight to `transaction.created`.
3. The "Limited availability" warning gates the entire `requested` interaction
   to Partner-Managed.

### The sandbox caveat (important — don't be fooled by it)

In **sandbox** you *will* observe an `action: "requested"` event even on a
Rain-Managed program. This is a **simulator artifact**, not production behavior:

- `POST /simulate/transactions/authorize` always emits **both**
  `transaction.requested` (on arrival) and `transaction.created` (on approval),
  for every program type.
- Rain's `sample-webhooks.mdx` full-lifecycle sample includes a `requested`
  envelope (with `status: pending` and the sandbox auto-approve last name
  `approved`).

**Author guidance for Rain-Managed integrators:** skip/ignore any
`action: "requested"` event. Never block on it, never build approve/decline
logic around it. Treat `transaction.created` as the source of truth — that is
the first actionable event in production.

## Rain-Managed authorization flow (what you actually receive)

```
Merchant → Rain     Auth request ($100)
Rain → Ledger       Check balance → sufficient
Rain → Ledger       Place hold ($100)
Rain → Merchant     Auth approved          ← Rain answered the network
Rain → YOU          transaction.created webhook ($100, status=pending)
YOU → Rain          200 (acknowledged)
        …later…
Rain → YOU          transaction.completed webhook (settlement)
```

## Partner-Managed authorization flow (for contrast — NOT this skill)

```
Merchant → Rain     Auth request ($100)
Rain runs basic checks
Rain → YOU          transaction.requested webhook   ← you must answer
YOU → Rain          200 to approve  /  401|40X + rejectionCode to decline
Rain → Merchant     Approved / Declined
Rain → YOU          transaction.created webhook (status=pending or declined)
```

`rejectionCode` enum (Partner-Managed only): `INSUFFICIENT_FUNDS`,
`SUSPICIOUS_TRANSACTION`, `NOT_PERMITTED`, `UNKNOWN`. (Docs also show a lowercase
variant `insufficient_funds` in one changelog example — a known casing
discrepancy; this is Partner-Managed territory regardless.)

## What both program types share

Once an authorization exists, the **lifecycle and webhook payloads are the
same** for both program types: `transaction.created` → `transaction.updated`
(reversals/increments) → `transaction.completed` (settlement). The only
difference is the leading `transaction.requested` answer step, which only
Partner-Managed performs. So the receiver, signature verification, idempotency,
ordering, and lifecycle handling in this skill apply to both — Rain-Managed just
omits the approve/decline step.
