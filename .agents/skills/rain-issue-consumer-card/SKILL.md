---
name: rain-issue-consumer-card
description: Issue a Rain consumer card end-to-end — create a KYC user application (`POST /issuing/applications/user`), upload compliance docs (multipart `PUT`), poll/await KYC approval, create a virtual or physical card (`POST /issuing/users/{userId}/cards`), and securely retrieve + decrypt the encrypted PAN/CVC (`GET /issuing/cards/{cardId}/secrets`; RSA-OAEP session id + AES-128-GCM). TRIGGER when onboarding a cardholder, running KYC, issuing/activating a card, fetching full card details, decrypting card secrets, or building a scoped card for an AI agent (`POST /issuing/users/{userId}/cards/scoped`). SKIP corporate/KYB onboarding; for auth/SDK/idempotency/error-handling → `rain-api-auth`; for spend webhooks after a card is live → `rain-managed-authorizations`.
allowed-tools: Read, Write, Bash
---

# Rain — issue a consumer card end-to-end

Take a cardholder from "no record" to "decrypted card number in hand": create a
KYC application, upload compliance documents, wait for approval, issue a virtual
or physical card, and decrypt its PAN/CVC.

This skill covers the **Consumer Program** (individual cardholders). For
corporate/KYB onboarding, stop — that is a different flow and out of scope.

## ⚠️ Sandbox first, and never log decrypted secrets

- Do this work against **sandbox** (`https://api-dev.raincards.xyz/v1`) with a
  sandbox `RAIN_API_KEY`. A sandbox key cannot move real money or expose real PII.
- **Never log, print, or persist a decrypted PAN or CVC.** The whole point of the
  encryption scheme is that plaintext card data exists only momentarily in memory.
  Decrypt, hand to the UI/secure surface, discard. The examples in this skill print
  only `last4`.
- The card-secret session-id uses the **SessionId** RSA key (`references/sessionid-public-keys.md`),
  which is **NOT** the KYC-payload key. Mixing them up fails silently — see Step 5.

Auth, SDK install/init, idempotency, retries, timeouts, and error handling all
live in [`rain-api-auth`](../rain-api-auth/SKILL.md). This skill assumes a
client is already initialized.

## Prerequisites

- **SDK initialized** (or a working curl setup) per [`rain-api-auth`](../rain-api-auth/SKILL.md).
  TS `@rainapi/rain-sdk`, Go `github.com/SignifyHQ/rain-sdk-go`, Python `rain-sdk`.
- **Rain-Managed programs require a wallet address per user.** If your tenant is
  Rain-Managed, every user MUST carry one of `walletAddress` (EVM), `solanaAddress`,
  or `stellarAddress` on the application, or downstream card spend has no collateral
  to draw against. Provision these before Step 1. (Partner-Managed: not required.)
- **For scoped/agent cards:** the `/cards/scoped` endpoint is **gated** — it must be
  enabled for your tenant during onboarding (see the Scoped cards section). Calling it
  without enablement returns `403`.

## The flow in one picture

```
 ┌──────────────────────────────┐
 │ Step 1  Create application    │  POST /issuing/applications/user
 │  (full PII OR share-token)    │  → returns IssuingUser; its id == userId
 └───────────────┬──────────────┘
                 │ userId
 ┌───────────────▼──────────────┐
 │ Step 2  Upload documents      │  PUT /issuing/applications/user/{userId}/document
 │  (multipart, ≤20 MB, ID+selfie│  → 204 on success; 400 "Document rejected" = fastfail
 └───────────────┬──────────────┘
                 │ docs submitted
 ┌───────────────▼──────────────┐  ┌─────────────────────────────────────┐
 │ Step 3  Await KYC             │─▶│ poll GET …/applications/user/{userId}│
 │  (Rain runs checks, async)    │  │   OR consume `user.updated` webhook  │
 └───────────────┬──────────────┘  └─────────────────────────────────────┘
                 │ applicationStatus == "approved"
 ┌───────────────▼──────────────┐
 │ Step 4  Create card           │  POST /issuing/users/{userId}/cards
 │  (virtual | physical; limit   │  → returns IssuingCard (cardId)
 │   in CENTS + frequency enum)  │
 └───────────────┬──────────────┘
                 │ cardId
 ┌───────────────▼──────────────┐
 │ Step 5  Retrieve + decrypt    │  generate SessionId (RSA-OAEP+SHA-1)
 │  secrets                       │  → GET /issuing/cards/{cardId}/secrets
 │  (SESSION-ID key, AES-128-GCM)│  → AES-128-GCM decrypt {iv,data}
 └───────────────┬──────────────┘
                 │ (optional)
 ┌───────────────▼──────────────┐
 │ Step 6  Activate [optional]   │  only if card was created notActivated
 └──────────────────────────────┘
```

Steps 1–4 are server-side REST. Step 5 is the crypto-heavy part and the single
highest-value, highest-risk piece of this skill — get the decrypt exactly right.

## Step 1 — Create the application

`POST /issuing/applications/user` (operationId `createIssuingUserApplication`).
Returns an `IssuingUser`; **its `id` is the `userId`** you use for documents and
cards in every later step. Response is `200`.

The request body is one of **three variants** (a `oneOf`) merged with a common object:

1. **Full PII** ("Using API") — you supply identity fields directly.
2. **Sumsub share token** — `{ sumsubShareToken, sumsubShareTokenMode? }`.
3. **Persona share token** — `{ personaShareToken }` (the Persona inquiry ID).

The **common object is required on all three variants** and its required fields are
exactly: `ipAddress`, `occupation`, `annualSalary`, `accountPurpose`,
`expectedMonthlyVolume`. (`isTermsOfServiceAccepted` is **not** in the required set,
but Rain's own examples always send `true`, and if you send it, it must be `true` —
recommend sending `isTermsOfServiceAccepted: true`.)

For the full-PII variant the additional required fields are: `firstName`, `lastName`,
`birthDate`, `nationalId` (9-digit SSN for US), `countryOfIssue`, `email`,
`phoneCountryCode`, `phoneNumber`, `address`. **Send `phoneCountryCode`/`phoneNumber` even
though the OpenAPI spec marks them optional — the sandbox rejects the create without them.**
Both are digits-only (`^[0-9]+$`): e.g. `phoneCountryCode: "1"`, `phoneNumber: "5125550100"`.

Full field reference (required vs optional, all three variants, wallet rules):
[`references/application-fields.md`](references/application-fields.md).

### SDK (TypeScript)

```ts
import Rain from '@rainapi/rain-sdk';

const client = new Rain({ apiKey: process.env['RAIN_API_KEY'], environment: 'dev' });

const application = await client.applications.user.create({
  // common object (required on every variant)
  ipAddress: '203.0.113.10',
  occupation: '15-1252',            // SOC code
  annualSalary: '50000-100000',
  accountPurpose: 'web3Payments',
  expectedMonthlyVolume: '1000-5000',
  isTermsOfServiceAccepted: true,   // recommended; if sent must be true
  // Rain-Managed only: one wallet field is required
  walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
  // full-PII variant
  firstName: 'Jane',
  lastName: 'Doe',                  // sandbox: include "approved" to auto-approve (see below)
  birthDate: '1990-04-15',
  nationalId: '123456789',
  countryOfIssue: 'US',
  email: 'jane.doe@example.com',
  phoneCountryCode: '1',            // required in practice (spec marks it optional)
  phoneNumber: '5125550100',        // digits only, ^[0-9]+$
  address: { line1: '123 Main St', city: 'New York', region: 'NY', postalCode: '10001', countryCode: 'US' },
});

const userId = application.id;       // <-- carry this forward
```

### SDK (Go / Python)

Same fields, idiomatic per language. Go wraps optionals in helpers
(`rainsdk.String(...)`, `rainsdk.Bool(...)`) on `rainsdk.ApplicationUserNewParams{}`
and reads `app.ID`; Python uses snake_case keyword args
(`ip_address`, `annual_salary`, `is_terms_of_service_accepted=True`, …) on
`client.applications.user.create(...)` and reads `application.id`. Full runnable
files: [`examples/issue-card-end-to-end.go`](examples/issue-card-end-to-end.go),
[`examples/issue-card-end-to-end.py`](examples/issue-card-end-to-end.py).

### curl (first-class for any non-SDK language)

```bash
curl -sS -X POST "https://api-dev.raincards.xyz/v1/issuing/applications/user" \
  -H "Api-Key: $RAIN_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{ "ipAddress":"203.0.113.10", "occupation":"15-1252", "annualSalary":"50000-100000",
        "accountPurpose":"web3Payments", "expectedMonthlyVolume":"1000-5000",
        "isTermsOfServiceAccepted":true, "walletAddress":"0x1234...5678",
        "firstName":"Jane", "lastName":"Doe approved", "birthDate":"1990-04-15",
        "nationalId":"123456789", "countryOfIssue":"US", "email":"jane.doe@example.com",
        "phoneCountryCode":"1", "phoneNumber":"5125550100",
        "address":{"line1":"123 Main St","city":"New York","region":"NY","postalCode":"10001","countryCode":"US"} }'
```

Full runnable curl + the two share-token variants (no PII in the body):
[`examples/curl/create-application.sh`](examples/curl/create-application.sh).

> **Blocklisted wallet:** a blocklisted address returns `400 Bad Request` and rejects the
> application — surface it, don't retry. Always send an `Idempotency-Key` on this create
> call (see [`rain-api-auth`](../rain-api-auth/SKILL.md)).

## Step 2 — Upload compliance documents

`PUT /issuing/applications/user/{userId}/document` (it is **PUT**, not POST),
`multipart/form-data`, addressed by `userId`. Call it **once per document**. Files up
to **20 MB**. Success is **`204`** (no body).

For KYC, Rain accepts exactly: one **identification** doc (Passport, ID card,
Driver's license, or Residence permit) **plus a Selfie**. Other types upload but
won't be approved. Full matrix, `type`/`side` enums, country handling:
[`references/document-requirements.md`](references/document-requirements.md).

### SDK (TypeScript)

```ts
import { createReadStream } from 'node:fs';

await client.applications.user.uploadDocument(userId, {
  document: createReadStream('./passport.png'),
  type: 'passport',
  countryCode: 'US',
  // side: 'front',  // ID card / drivers / residencePermit only; OMIT for passport
});
```

Python: `client.applications.user.upload_document(user_id, document=open("passport.png","rb"),
type="passport", country_code="US")`. Go: `client.Applications.User.UploadDocument(ctx,
userID, rainsdk.ApplicationUserUploadDocumentParams{...})`.

### curl

```bash
curl -sS -X PUT "https://api-dev.raincards.xyz/v1/issuing/applications/user/$USER_ID/document" \
  -H "Api-Key: $RAIN_API_KEY" \
  -F "document=@./passport.png" \
  -F "type=passport" \
  -F "countryCode=US"
# then a second call for the selfie:
curl -sS -X PUT "https://api-dev.raincards.xyz/v1/issuing/applications/user/$USER_ID/document" \
  -H "Api-Key: $RAIN_API_KEY" \
  -F "document=@./selfie.jpg" \
  -F "type=selfie"
```

### Handle the `400 "Document rejected"` fastfail

A rejected document returns `400` **before** any human review. Two shapes are
documented — **parse both** (don't assume one):

```json
{ "statusCode": 400, "error": "BadRequestError",
  "message": "Document rejected: UNSATISFACTORY_PHOTOS, LOW_QUALITY",
  "errorMessageCodes": ["UNSATISFACTORY_PHOTOS", "LOW_QUALITY"] }
```
```json
{ "statusCode": 400, "error": "Bad Request",
  "message": "Document rejected by Sumsub: forbiddenDocument, missingImportantInfo" }
```

The `message` field carries a comma-separated list of rejection tags;
`errorMessageCodes` (when present) carries them as an array. **Error tags** (e.g.
`forbiddenDocument`, `expiredDoc`, `dataNotReadable`) require a **different**
document — don't retry the same file. **Warning tags** (e.g. `badSelfie`,
`maybeExpiredDoc`) allow a retake. After a rejection the application moves to a
re-submission state and the user must resubmit. Full tag tables:
[`references/document-requirements.md`](references/document-requirements.md).

## Step 3 — Await KYC approval

Rain runs automated (and sometimes manual) checks asynchronously. You learn the
outcome in one of two ways:

1. **Poll** `GET /issuing/applications/user/{userId}` and read `applicationStatus`.
2. **Consume the `user.updated` webhook** — preferred for production; no polling.
   See [`rain-managed-authorizations`](../rain-managed-authorizations/SKILL.md) for
   the webhook receiver + signature verification (the `user.updated` event carries
   `eventReceivedAt` for ordering).

### Poll loop (TypeScript)

```ts
async function awaitApproval(userId: string, { timeoutMs = 120_000, intervalMs = 4_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const app = await client.applications.user.get(userId);
    const status = app.applicationStatus;
    if (status === 'approved') return app;
    if (['denied', 'locked', 'canceled', 'exempt'].includes(status))
      throw new Error(`Application terminal-failed: ${status}`);
    if (['needsVerification', 'needsInformation'].includes(status)) {
      // user action required — redirect them to app.applicationCompletionLink
      throw new Error(`Action required (${status}); send user to applicationCompletionLink`);
    }
    // pending | manualReview | notStarted → keep waiting
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Timed out waiting for KYC');
}
```

### curl

```bash
curl -sS "https://api-dev.raincards.xyz/v1/issuing/applications/user/$USER_ID" \
  -H "Api-Key: $RAIN_API_KEY" | jq '.applicationStatus'
```

### The `applicationStatus` state table (summary)

| Status | Terminal? | You must act? | Meaning |
|---|---|---|---|
| `approved` | yes | no | Approved; cardholder created — proceed to Step 4 |
| `pending` | no | no | Automated checks running — wait |
| `manualReview` | no | no | A Rain analyst is reviewing — wait |
| `notStarted` | no | maybe | Created, processing not begun — may need a redirect |
| `needsVerification` | no | **yes** | Send user to `applicationCompletionLink`; do NOT POST docs via API |
| `needsInformation` | no | **yes** | Docs rejected; resubmit via redirect or update endpoints |
| `denied` | yes | no | Permanently denied |
| `locked` | yes | no | Locked by Rain compliance |
| `canceled` | yes | no | You canceled it |
| `exempt` | yes | no | Manually set by Rain for special cases |

When the application is in any non-approved state, the response includes an
`applicationCompletionLink` `{ url, params }`. **Pass every returned param through**
(prose docs mention a `signature` param not modeled in the spec) and append your own
`redirect` param. Full state machine, Sumsub mappings, and link handling:
[`references/application-states.md`](references/application-states.md).

> **Sandbox shortcut:** a user whose **last name contains `approved`**
> (case-insensitive — `Doe approved`, `TestApproved`, `approved` all work) auto-approves.
> Whitespace breaks the match, so `Needs Verification` does **not** map to a status —
> use a single contiguous token like `needsverification`. **Remove this before go-live.**

## Step 4 — Create the card

`POST /issuing/users/{userId}/cards` (operationId `createIssuingCard`). The only
**required** body field is `type` (`virtual` | `physical`); `limit` is optional and
can be changed later. Returns an `IssuingCard` with a `cardId`.

### `limit` — amounts are in CENTS

`limit` is `{ amount, frequency }` and **both are required if you send `limit`**.
`amount` is an **integer in cents** (`50000` = $500.00). `frequency` is one of:

`per24HourPeriod`, `per7DayPeriod`, `per30DayPeriod`, `perYearPeriod`, `allTime`,
`perAuthorization`.

`per30DayPeriod` is the rolling-30-day "belt": every purchase falls off exactly 30
days (to the second) after it was made.

### `configuration.displayName` rules

- Max **26 characters**, pattern `^[a-zA-Z0-9 .-]+$` (letters, digits, space, period, hyphen).
- Used to emboss **physical** cards. The spec says it is *ignored for virtual cards*,
  but the prose docs apply it to virtual too (it appears in card-network records) —
  this is a known doc conflict; sending it is harmless either way.
- For non-Latin names, transliterate (e.g. `곽서준` → `KWAK SEO JUN`); physical
  embossing is Latin-only, no diacritics.
- If omitted: the user's `firstName` + `lastName` (trimmed to 26 chars) is used.

### SDK (TypeScript) — virtual card

```ts
const card = await client.users.createCard(
  userId,
  {
    type: 'virtual',
    limit: { amount: 50000, frequency: 'per30DayPeriod' }, // $500.00 / rolling 30 days
    configuration: { displayName: 'JANE DOE' },
  },
  { headers: { 'Idempotency-Key': crypto.randomUUID() } },
);
const cardId = card.id;
```

Go/Python mirror this: `client.Users.NewCard(ctx, userID, rainsdk.UserNewCardParams{...})`
and `client.users.create_card(user_id, type="virtual", limit={"amount":50000,
"frequency":"per30DayPeriod"}, extra_headers={"Idempotency-Key": str(uuid.uuid4())})`.

### curl — virtual

```bash
curl -sS -X POST "https://api-dev.raincards.xyz/v1/issuing/users/$USER_ID/cards" \
  -H "Api-Key: $RAIN_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{ "type": "virtual",
        "limit": { "amount": 50000, "frequency": "per30DayPeriod" },
        "configuration": { "displayName": "JANE DOE" } }'
```

### Physical cards

Set `type: "physical"` and include `shipping` (recipient address + `phoneNumber`).
Physical cardholder names must be Latin-only. Shipping `method` ∈
`standard`, `express`, `international`, `apc`, `uspsInternational`. Full physical-card
body, shipping schema, and per-tier card/velocity limits:
[`references/application-fields.md`](references/application-fields.md) is for the
*application*; card-side limits and shipping are summarized in
[`examples/issue-card-end-to-end.ts`](examples/issue-card-end-to-end.ts).

> **Per-tier limits (cards per user):** Developer 3 (active only); Startup 10;
> Enterprise consumer 50. Velocity (rolling 90 days): Developer 3; Startup consumer 10.
> Hitting a limit returns `400`.

## Step 5 — Retrieve and decrypt the card secrets

This is the part agents get wrong. The PAN and CVC are returned **encrypted**; you
decrypt them client-side with a key only you hold. Two sub-steps:

**(a) Generate a `SessionId`** (RSA-OAEP, hash **SHA-1**) using the
**SessionId public key for your environment** — dev vs prod, from
[`references/sessionid-public-keys.md`](references/sessionid-public-keys.md).

> ⚠️ **Use the SessionId key, NOT the KYC-payload key.** They are different keypairs
> (SessionId = 1024-bit; KYC = 2048-bit). Encrypting with the wrong PEM means Rain
> can't recover your session secret and the secrets won't decrypt — and it fails
> *silently* (no clear error). This is the #1 cause of "decryption returns garbage".

**(b) Call `GET /issuing/cards/{cardId}/secrets`** with the `SessionId` header
(**PascalCase** for this endpoint), then **AES-128-GCM decrypt** each
`{ iv, data }` pair with the 16-byte key derived from your session secret.

### The session-id + decrypt, in code

The helper scripts implement the full, corrected algorithm — use them rather than
re-deriving:

- [`scripts/generate-session-id.ts`](scripts/generate-session-id.ts) / `.py` / `.go`
- [`scripts/decrypt-card-secret.ts`](scripts/decrypt-card-secret.ts) / `.py` / `.go`

```ts
import { generateSessionId } from './scripts/generate-session-id';
import { decryptSecret }    from './scripts/decrypt-card-secret';
import { DEV_SESSIONID_PUBLIC_KEY } from './references/sessionid-public-keys';

// (a) make a session id; keep the returned secretKey for decryption
const { sessionId, secretKey } = generateSessionId(DEV_SESSIONID_PUBLIC_KEY);

// (b) fetch encrypted secrets — header is PascalCase `SessionId` for this endpoint
const secrets = await client.cards.getSecrets(cardId, {
  headers: { SessionId: sessionId },
});

// decrypt: arg order is (data, iv, secretKey)
const pan = decryptSecret(secrets.encryptedPan.data, secrets.encryptedPan.iv, secretKey);
const cvc = decryptSecret(secrets.encryptedCvc.data, secrets.encryptedCvc.iv, secretKey);
console.log('issued card ending', pan.slice(-4)); // never log the full PAN/CVC
```

### curl (manual)

```bash
# Generate the SessionId with the helper, then:
curl -sS "https://api-dev.raincards.xyz/v1/issuing/cards/$CARD_ID/secrets" \
  -H "Api-Key: $RAIN_API_KEY" \
  -H "SessionId: $SESSION_ID" \
  -H "accept: application/json"
# → { "encryptedPan": {"iv":"...","data":"..."}, "encryptedCvc": {"iv":"...","data":"..."} }
# Pipe each {iv,data} into scripts/decrypt-card-secret.* with the secretKey you kept.
```

### Why the official Node snippet is wrong (and ours is right)

Rain's published Node decrypt snippet **skips `setAuthTag()` and `.final()`** and runs
`decipher.update()` over the *entire* buffer — i.e. it decrypts the ciphertext **plus
the 16-byte GCM auth tag** as if the tag were more ciphertext. The result has 16
trailing garbage bytes and the tag is never verified (tampering goes undetected). The
trailing `.trim()` does **not** reliably strip them. Our `decrypt-card-secret.*`:

1. Splits the base64-decoded `data` into `ciphertext = buf[..-16]` and `authTag = buf[-16..]`.
2. Calls `setAuthTag(authTag)`.
3. Decrypts **only the ciphertext** and calls `final()` (which verifies the tag).

Full algorithm spec, the bug analysis, and the WebCrypto cross-check oracle:
[`references/card-secret-encryption.md`](references/card-secret-encryption.md).

> **Decrypt-fail recovery:** decryption is client-side, so the card already exists even
> if your decrypt step throws. Don't re-issue. Re-`GET /issuing/cards/{cardId}/secrets`
> with a fresh `SessionId` and try again.

## Step 6 — Activate the card [optional]

By default cards are usable immediately. To enforce an activation flow, create the card
with `status: "notActivated"`, confirm the last4/expiry with `GET /issuing/cards/{cardId}`,
then update the status to `active`:

```bash
curl -sS -X PATCH "https://api-dev.raincards.xyz/v1/issuing/cards/$CARD_ID" \
  -H "Api-Key: $RAIN_API_KEY" -H "Content-Type: application/json" \
  -d '{ "status": "active" }'
```

Card statuses: `notActivated`, `active`, `locked` (temporary), `canceled` (permanent).

## Scoped cards (agent / single-purpose cards)

A **scoped card** is a tightly-limited card — ideal for handing to an AI agent for a
single purchase. It is created and its secrets are returned **inline in one call**, so
there is no separate get-secrets round-trip.

> ⚠️ **Gated.** `/cards/scoped` is protected and **must be enabled for your tenant
> during onboarding**. If it isn't, you get `403 Forbidden`. Ask your Rain contact to
> enable it before integrating.
>
> ⚠️ **`/cards/agentic` is deprecated.** The old `POST /issuing/users/{userId}/cards/agentic`
> is `deprecated: true` and its docs literally say "Use `/issuing/users/{userId}/cards/scoped`
> instead." Always use `/cards/scoped`.

`POST /issuing/users/{userId}/cards/scoped`. Required body: `{ amountInUSDCents }`
(integer ≥ 1). Header is lowercase **`sessionid`** for this endpoint (contrast Step 5's
PascalCase `SessionId` — use each as written).

- The card's **lifetime limit is capped at 1.2×** `amountInUSDCents` to absorb auth
  holds (the buffer is configurable during onboarding).
- Response includes `id`, `last4`, `expirationMonth`/`expirationYear` (**strings** per
  spec), `status`, and inline `encryptedPan`/`encryptedCvc` `{ iv, data }` — decrypt
  exactly as in Step 5 (same SessionId key + AES-128-GCM).
- **Default limits** (configurable during onboarding): 10 active scoped cards/user;
  10 created/user per rolling 24h (else `400`); $5,000 approved spend/user across scoped
  cards per rolling 24h. Over-limit spend is declined at auth with
  `agentic_daily_spend_limit_exceeded`.
- **Decrypt-fail recovery:** the card exists even if decrypt fails — use the returned
  `id` to retry `GET /issuing/cards/{id}/secrets`.

```ts
// header is lowercase `sessionid` for the scoped endpoint
const { sessionId, secretKey } = generateSessionId(DEV_SESSIONID_PUBLIC_KEY);
const scoped = await client.users.createScopedCard(
  userId,
  { amountInUSDCents: 4299 },         // $42.99; lifetime cap = 1.2× = $51.59
  { headers: { sessionid: sessionId } },
);
const pan = decryptSecret(scoped.encryptedPan.data, scoped.encryptedPan.iv, secretKey);
```

curl: [`examples/curl/create-scoped-card.sh`](examples/curl/create-scoped-card.sh).
Full runnable example: [`examples/issue-scoped-card.ts`](examples/issue-scoped-card.ts).

## Sandbox testing

- Base URL `https://api-dev.raincards.xyz/v1`, sandbox `RAIN_API_KEY`.
- Auto-approve: last name contains `approved` (case-insensitive, no whitespace inside
  the token).
- Use the **dev** SessionId PEM from [`references/sessionid-public-keys.md`](references/sessionid-public-keys.md).
- Round-trip works end-to-end without uploading real PII when the approved-name shortcut
  fast-forwards KYC.

## Go-live checklist

- [ ] Switch base URL to `https://api.raincards.xyz/v1` and use a **production** `RAIN_API_KEY`.
- [ ] Switch to the **production** SessionId PEM (and confirm you are NOT using a KYC key).
- [ ] **Remove the `approved`-last-name shortcut** — it does nothing in prod but shouldn't ship.
- [ ] Rain-Managed: every user has a provisioned wallet address.
- [ ] **Never log decrypted PAN/CVC.** Audit your logging.
- [ ] `Idempotency-Key` on every create call (application, card, scoped card).
- [ ] If using scoped cards: confirm the tenant is enabled (no `403`).
- [ ] Decrypt verified against a known triple (the corrected GCM impl round-trips).

## What's next

- **Spend webhooks once cards are live** (transaction lifecycle, signature verification):
  [`rain-managed-authorizations`](../rain-managed-authorizations/SKILL.md).
- **Auth / SDK / idempotency / retries / errors:** [`rain-api-auth`](../rain-api-auth/SKILL.md).
- **Any other Rain endpoint** (balances, transfers, disputes): `rain-api-generic`.

## See also

- [`references/application-fields.md`](references/application-fields.md) — create-application required/optional fields, all three `oneOf` variants, wallet rules.
- [`references/application-states.md`](references/application-states.md) — full `applicationStatus` state machine, Sumsub mappings, `applicationCompletionLink` handling.
- [`references/document-requirements.md`](references/document-requirements.md) — accepted doc types, `type`/`side` enums, the two 400-reject shapes, rejection tags.
- [`references/card-secret-encryption.md`](references/card-secret-encryption.md) — the exact corrected RSA-OAEP + AES-128-GCM algorithm and the official-snippet bug analysis.
- [`references/sessionid-public-keys.md`](references/sessionid-public-keys.md) — dev + prod SessionId PEMs (NOT the KYC keys).
- [`scripts/`](scripts/) — `generate-session-id.{ts,py,go}`, `decrypt-card-secret.{ts,py,go}`.
- [`examples/`](examples/) — `issue-card-end-to-end.{ts,go,py}`, `issue-scoped-card.ts`, `curl/*.sh`.
- [`rain-api-auth`](../rain-api-auth/SKILL.md) — shared auth/SDK building blocks.
