# Decline reasons

`declinedReason` is sent on `transaction.created` (and on `transaction.updated`
when `status: declined`). Under Rain-Managed you **cannot prevent a decline** —
Rain already decided — so this field is purely for logging, analytics, and
user-facing messaging.

## The one rule that matters

**Match against the standard list below. Treat anything unrecognized as a
generic decline.** Do **not** branch business logic on arbitrary strings —
processor-originated reasons are free-form, configurable at the processor, and
can change without notice.

## Standard `declinedReason` values

Delivered lowercase, space-separated. This is the fixed enumeration you can
safely branch on:

```
account credit limit exceeded
agentic daily spend limit exceeded
balance inquiry not permitted
blocked entity
blocked mcc
blocked merchant
card canceled
card locked
card not activated
card spending limit exceeded
cvv mismatch
expiry mismatch
invalid pin
invalid pin attempt limit exceeded
restricted country
transaction declined by risk rules
transaction declined by rules
webhook declined
webhook timeout
```

Note: `agentic daily spend limit exceeded` is a standard value — an
authorization on an agentic card declined because the user's 24-hour agentic
spend across all their agentic cards would exceed the configured daily limit
(default $5,000).

## Processor-originated reasons — DO NOT branch on these

> "Some declines originate at the card processor rather than from a Rain rule,
> and these take precedence over the standard reasons above. When this happens,
> `declinedReason` contains a normalized (lowercase, free-form) description of
> the processor's reason instead of one of the standard values — for example
> `restricted card` or `transaction not permitted to cardholder`. In rare cases
> it may be empty."
>
> "Because these descriptions are configured at the processor and can change,
> the table below is a non-exhaustive list of examples, not a fixed enumeration.
> **Do not branch business logic on these strings — match the standard reasons
> above and treat anything unrecognized as a generic decline.**"

Non-exhaustive example processor reasons (for reference only — do not enumerate
in code): Invalid PAN, Wrong PIN, Invalid CVV, Invalid ARQC, Invalid AAV, Card
Expired, Wrong ATC, Invalid Service Code, Non-ATM Withdrawal, Card Status,
Account Status, Blacklisted Country, Data Contradiction, Card/Client Rules,
Amount Limit, Agentic Daily Spend Limit, Online PIN Limit, Offline PIN Limit,
PIN Change Mismatch, AVS Failure, 3DS Failure, Cashback Unsupported, E-commerce
Flag, ATM Cash Flag, Balance Enquiry Flag, Suspicious Transaction.

## Recommended handling pattern

```ts
const STANDARD_DECLINE_REASONS = new Set([
  "account credit limit exceeded",
  "agentic daily spend limit exceeded",
  "balance inquiry not permitted",
  "blocked entity",
  "blocked mcc",
  "blocked merchant",
  "card canceled",
  "card locked",
  "card not activated",
  "card spending limit exceeded",
  "cvv mismatch",
  "expiry mismatch",
  "invalid pin",
  "invalid pin attempt limit exceeded",
  "restricted country",
  "transaction declined by risk rules",
  "transaction declined by rules",
  "webhook declined",
  "webhook timeout",
]);

function classifyDecline(reason: string | undefined): string {
  if (reason && STANDARD_DECLINE_REASONS.has(reason)) return reason;
  // Processor-originated or empty → generic. Log the raw string, branch generically.
  return "generic_decline";
}
```

## Not the same as the sandbox simulate `declineReason`

The sandbox simulate API (`POST /simulate/transactions/authorize`) accepts a
separate **snake_case** `declineReason` enum *in the request body* to force a
specific decline:

```
account_credit_limit_exceeded  card_locked  card_canceled  card_not_activated
blocked_mcc  blocked_merchant  balance_inquiry_not_permitted  expiry_mismatch
cvv_mismatch  invalid_pin  restricted_country
```

That snake_case set is **what you send to the simulator**, not what Rain
delivers. The **delivered webhook** uses the lowercase space-separated
`declinedReason` strings above. Don't conflate the two.
