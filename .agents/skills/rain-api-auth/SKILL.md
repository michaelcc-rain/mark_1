---
name: rain-api-auth
description: Authenticate to the Rain card-issuing API and set up the SDK. TRIGGER when the user calls/authenticates/sets up the Rain API, installs/initializes the Rain SDK (`@rainapi/rain-sdk`, `rain-sdk-go`, `rain-sdk`), debugs 401/403 against raincards.xyz, sets the `Api-Key` header, configures base URLs/environments, or needs the shared building blocks every other Rain skill depends on — error handling, retries, timeouts, idempotency, cursor pagination, and **HMAC-SHA256 webhook signature verification**. SKIP the end-to-end flows — card issuance + KYC → `rain-issue-consumer-card`; webhook receipt + transaction lifecycle → `rain-managed-authorizations`.
allowed-tools: Read, Write, Bash
---

# Rain — API authentication & SDK setup

The foundation every other Rain skill builds on. How to authenticate to the
Rain card-issuing API, initialize the SDK (TypeScript / Go / Python) or call
the REST API directly, and the shared building blocks — errors, retries,
timeouts, idempotency, cursor pagination, logging, and **HMAC-SHA256 webhook
signature verification**.

Source of truth: the Rain API reference (`Authenticating with the API`,
`Idempotency`), the SDK docs (`SDKs › Overview`, `SDKs › Configuration`), and
`Webhooks overview`.

## ⚠️ Sandbox keys only

**Never share, paste, or use a production Rain API key with Claude.** If the
user offers a prod key, refuse and ask for a **sandbox** key instead.

- Sandbox keys are minted in the Rain dashboard under **Config › API Keys**
  while you target the sandbox environment. They are scoped to sandbox data —
  no real cardholders, no real money, no real PII.
- A production key grants full programmatic access to live cardholders, cards,
  and balances, and **doubles as your webhook signing secret** (see the
  dual-use callout below). Treat it like a banking credential.
- The sandbox and production environments are different hosts
  (`api-dev.raincards.xyz` vs `api.raincards.xyz`). A sandbox key will not work
  against production, so insisting on sandbox is also the practical default.

If the user pastes what looks like a production key into the conversation, flag
it immediately, advise rotating it in the dashboard, and continue only with a
sandbox key.

## What you need from the user

| Var | Where it comes from |
|---|---|
| `RAIN_API_KEY` | Rain dashboard → **Config › API Keys** → create a key (sandbox). Copy the secret value when it is created. The SDK reads this env var by default. |
| environment | `dev` (sandbox) or `production` (live). Defaults to `dev` in all three SDKs. |
| `ipAddresses` *(optional)* | An IP allowlist set at key-creation time. See [IP restrictions](#ip-restrictions-optional). |

Advise the user to store the key in `.claude/settings.local.json` (gitignored,
auto-loaded by Claude Code) or in `.env`:

```json
// .claude/settings.local.json
{
  "env": {
    "RAIN_API_KEY": "sandbox-key-value-here"
  }
}
```

```bash
# .env  (see examples/.env.example)
RAIN_API_KEY=sandbox-key-value-here
```

If the key is missing, stop and ask. Do not invent placeholders.

## Base URLs + environment selector

The `/v1` path prefix is part of the base URL.

| Environment | Base URL | SDK selector |
|---|---|---|
| Sandbox | `https://api-dev.raincards.xyz/v1` | `'dev'` (default) |
| Production | `https://api.raincards.xyz/v1` | `'production'` |

In TypeScript and Python `environment` is a string. **In Go it is an option
function** — `option.WithEnvironmentDev()` / `option.WithEnvironmentProduction()`
— not a string.

## Install & initialize the SDK

Official SDKs cover **TypeScript, Go, and Python**. For any other language, the
curl path below is first-class and complete.

| Language | Install | Package |
|---|---|---|
| TypeScript | `npm install @rainapi/rain-sdk` | `@rainapi/rain-sdk` |
| Go | `go get -u github.com/SignifyHQ/rain-sdk-go@v0.1.0` | `github.com/SignifyHQ/rain-sdk-go` |
| Python | `pip install rain-sdk` | `rain-sdk` (import `rain_sdk`) |

### TypeScript

```ts
import Rain from '@rainapi/rain-sdk';

const client = new Rain({
  apiKey: process.env['RAIN_API_KEY'],
  environment: 'dev', // use 'production' for live
});
```

### Go

```go
import (
	"context"
	"fmt"
	"os"

	rainsdk "github.com/SignifyHQ/rain-sdk-go"
	"github.com/SignifyHQ/rain-sdk-go/option"
)

client := rainsdk.NewClient(
	option.WithAPIKey(os.Getenv("RAIN_API_KEY")),
	option.WithEnvironmentDev(), // option.WithEnvironmentProduction() for live
)
```

### Python

```python
from rain_sdk import Rain

client = Rain(
    api_key="your-api-key",  # defaults to the RAIN_API_KEY env var
    environment="dev",       # use "production" for live
)
```

### Smoke-test (confirm the SDK + key work)

```ts
const companies = await client.companies.list();
console.log(companies);
```

```go
companies, err := client.Companies.List(context.TODO(), rainsdk.CompanyListParams{})
if err != nil { panic(err) }
fmt.Println(companies)
```

```python
companies = client.companies.list()
print(companies)
```

A `200` with a JSON body confirms auth works. A `401` means the key is wrong or
the environment mismatches — see [auth-pitfalls.md](references/auth-pitfalls.md).

The SDK exposes these resource namespaces: `client.applications`,
`client.balances`, `client.cards`, `client.companies`, `client.contracts`,
`client.disputes`, `client.keys`, `client.payments`, `client.signatures`,
`client.transactions`, `client.users`. (Go uses PascalCase fields:
`client.Cards`, `client.Transactions`, `client.Applications.User`, …)

Runnable verifiers ship in this skill:
[`scripts/verify-auth.ts`](scripts/verify-auth.ts),
[`verify-auth.go`](scripts/verify-auth.go),
[`verify-auth.py`](scripts/verify-auth.py),
[`verify-auth.sh`](scripts/verify-auth.sh) (curl).

## The `Api-Key` header (canonical)

> "Rain API uses API keys for authentication. Every request to the API must
> include a valid API key in the `Api-Key` header."

For any non-SDK language, send the key in the `Api-Key` header:

```bash
curl -X GET "https://api-dev.raincards.xyz/v1/companies" \
     -H "Api-Key: ${RAIN_API_KEY}"
```

`Authorization: Bearer <key>` is **also accepted** by the server, but `Api-Key`
is the canonical, documented scheme — lead with it. (The OpenAPI spec declares
`ApiKeyAuth` as the per-operation security scheme; bearer works but is not the
declared scheme.) Full triage of which header to use lives in
[auth-pitfalls.md](references/auth-pitfalls.md).

**Never expose API keys in client-side code** (browser JS, mobile apps). Always
use HTTPS — plain `http://` leaks the key.

## API-key roles & custom permissions

Keys carry a role. If no role is provided, it **defaults to `admin`**.

| Role | Description |
|---|---|
| `admin` | Full access to all API operations |
| `readonly` | Read-only access to all resources |
| `custom` | Granular `resource:action` permissions |
| `webhookSigning` | Used exclusively for signing webhook payloads |

A `custom` key requires a `permissions` array of `resource:action` strings
(e.g. `"transactionsAndDisputes:read"`). Resources: `applications`, `balances`,
`cardsAndShipping`, `companies`, `users`, `contractsAndSignatures`, `payments`,
`keys`, `reports`, `subtenants`, `transactionsAndDisputes`, `webhooks`.
Actions: `read`, `write`, `delete`. Full list + the `POST /issuing/keys`
request schema: [api-key-roles.md](references/api-key-roles.md).

> **Only PRIMARY keys can manage other keys.** You cannot create or revoke keys
> with a secondary key. Programmatic (secondary) keys must have a name and a
> future `expiresAt`.

## ⚠️ Your API key doubles as the webhook signing secret

This is the single most surprising thing about Rain auth, and external
integrators trip on it constantly:

**Rain signs every webhook with one of your tenant API keys as the HMAC
secret — the same kind of key you put in the `Api-Key` header.** By default a
tenant's auto-generated `admin` key is the signing key. This means:

- **Rotating the API key rotates webhook signing too.** If you revoke or
  replace the key that is currently the signing key, in-flight webhook
  signatures stop verifying. Plan rotations with the
  secondary-key → promote flow (see below).
- To verify a webhook, you HMAC with the **full value** of that API key. See
  [signature-verification.md](references/signature-verification.md) and
  [`scripts/verify-webhook.js`](scripts/verify-webhook.js) /
  [`verify-webhook.py`](scripts/verify-webhook.py).
- You can dedicate a purpose-built key to signing by giving it the
  `webhookSigning` role and selecting it in the dashboard (API Settings).
  Beyond the initial admin key, only `webhookSigning`-role keys can be selected,
  and you need key-management permission to change it.

Rotation endpoints: `POST /issuing/webhooks/apikey/secondary`
(`createSecondarySigningApiKey` — returns the new key value once) and
`POST /issuing/webhooks/apikey/secondary/promote`
(`promoteSecondarySigningApiKey`). While both keys are valid, Rain may send a
`Secondary-Signature` header — verify against `Signature` **or**
`Secondary-Signature`.

> **Card-secret decryption uses different keys, not your API key.** Retrieving
> and decrypting a card's PAN/CVC uses RSA session-id keys, covered in
> [`rain-issue-consumer-card`](../rain-issue-consumer-card/SKILL.md). Don't
> confuse those with the API-key-as-signing-secret described here.

## IP restrictions (optional)

At key creation you may pass an `ipAddresses` array (up to 100 entries; IPv4,
IPv6, or CIDR like `10.0.0.0/24`). If omitted or empty, requests from any IP are
allowed.

A request from a non-allowed IP returns **`401 Unauthorized` with message
`"Address invalid for API key"`** — distinguishing it from a bad-key 401. If
your smoke-test 401s only from some hosts, suspect the allowlist first. Triage:
[auth-pitfalls.md](references/auth-pitfalls.md).

## Error handling

The SDK throws typed errors keyed to the HTTP status:

| Error class | Status | When |
|---|---|---|
| `BadRequestError` | 400 | Missing or invalid parameters |
| `AuthenticationError` | 401 | Invalid or expired API key |
| `PermissionDeniedError` | 403 | Key lacks the required permission |
| `NotFoundError` | 404 | Resource doesn't exist |
| `ConflictError` | 409 | Conflicting update (auto-retried) |
| `UnprocessableEntityError` | 422 | Valid syntax, unprocessable request |
| `RateLimitError` | 429 | Too many requests (auto-retried) |
| `InternalServerError` | 500+ | Server-side issue (auto-retried) |

```ts
try {
  await client.companies.list();
} catch (err) {
  if (err instanceof Rain.AuthenticationError) { /* wrong key or environment */ }
  else if (err instanceof Rain.RateLimitError) { /* back off */ }
  throw err;
}
```

```python
from rain_sdk import Rain, AuthenticationError, RateLimitError
try:
    client.companies.list()
except AuthenticationError:  # wrong key or environment
    ...
except RateLimitError:       # back off
    ...
```

In Go every API error shares the type `*rainsdk.Error`; switch on
`apierr.StatusCode` after `errors.As(err, &apierr)`. Full status-to-cause table
and a 401 decision tree: [error-codes.md](references/error-codes.md).

## Retries & timeouts

The SDK **retries connection errors, 408, 409, 429, and 5xx up to 2 times**
with exponential backoff by default.

| | Configure max retries | Configure timeout |
|---|---|---|
| TS | `new Rain({ maxRetries: 5 })` or per-request `{ maxRetries: 0 }` | `new Rain({ timeout: 30_000 })` ms, or per-request `{ timeout: 120_000 }` |
| Python | `Rain(max_retries=5)` or `max_retries=0` per call | `Rain(timeout=30)` seconds, or `timeout=120` per call |
| Go | `option.WithMaxRetries(5)` (global or per-request) | see caveat below |

Default timeout is **60 seconds** (TS/Python); the SDK retries timed-out
requests.

> **Go timeout caveat.** The Go SDK applies **no default request timeout**.
> Always pass a `context.Context` with a deadline sized for the whole
> operation — `option.WithRequestTimeout(30*time.Second)` governs each
> individual attempt only, not the overall budget across retries. Use a
> `context.WithTimeout(...)` for the end-to-end deadline:

```go
ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
defer cancel()
_, err := client.Companies.List(ctx, rainsdk.CompanyListParams{})
```

## Idempotency

Send an `Idempotency-Key` header (≤ 64 chars; a UUID is ideal) on `POST`, `PUT`,
`PATCH`, and `DELETE` so a retry never double-charges or double-creates.

- Responses are cached **24 hours** from arrival. A duplicate with the same key
  returns the cached response without re-processing.
- **5xx responses are NOT cached** — safe to retry with the same key, the
  request runs again.
- **4xx responses ARE cached** — retrying with the same key returns the same
  error.
- Concurrent requests with the same key → only the first runs; the others get
  `429` with `{"msg":"Concurrent requests with same idempotency key, please try again later"}`.
- Response headers: `Idempotency-Key` (echoes the key) and `Idempotency-Cached`
  (`true`/`false`).

```ts
const card = await client.users.createCard(
  userId,
  { type: 'virtual' },
  { headers: { 'Idempotency-Key': crypto.randomUUID() } },
);
```

```go
card, err := client.Users.NewCard(
	context.TODO(),
	userID,
	rainsdk.UserNewCardParams{Type: rainsdk.UserNewCardParamsTypeVirtual},
	option.WithHeader("Idempotency-Key", "unique-request-id"),
)
```

```python
card = client.users.create_card(
    user_id,
    type="virtual",
    extra_headers={"Idempotency-Key": "unique-request-id"},
)
```

```bash
curl -X POST "https://api-dev.raincards.xyz/v1/issuing/users/${USER_ID}/cards" \
     -H "Api-Key: ${RAIN_API_KEY}" \
     -H "Content-Type: application/json" \
     -H "Idempotency-Key: $(uuidgen)" \
     -d '{"type":"virtual"}'
```

A retry-with-backoff example: [`examples/idempotent-retry.ts`](examples/idempotent-retry.ts).

## Cursor pagination

List endpoints use cursor-based pagination. **There is no paging envelope** —
list responses are bare JSON arrays, with no `next_cursor` / `hasMore` / `data`
wrapper. You advance by sending the **last item's `id`** as the `cursor`, and
detect the last page when a page returns **fewer items than `limit`**.

`limit` is an integer, min 1, **max 100, default 20**.

```ts
let cursor: string | undefined;
do {
  const transactions = await client.transactions.list({
    companyId: 'company_123',
    type: ['spend'],
    limit: 50,
    cursor,
  });
  for (const txn of transactions) console.log(txn.id, txn.type);
  cursor = transactions.length === 50
    ? transactions[transactions.length - 1].id
    : undefined;
} while (cursor);
```

```go
var cursor param.Opt[string]
for {
	page, err := client.Transactions.List(context.TODO(), rainsdk.TransactionListParams{
		CompanyID: rainsdk.String("company_123"),
		Type:      []string{"spend"},
		Limit:     rainsdk.Int(50),
		Cursor:    cursor,
	})
	if err != nil { panic(err) }
	for _, txn := range *page { // List returns *[]T — dereference to iterate
		fmt.Println(txn.ID, txn.Type)
	}
	if len(*page) < 50 { break } // partial page = last page
	cursor = rainsdk.String((*page)[len(*page)-1].ID)
}
```

```python
cursor = None
while True:
    transactions = client.transactions.list(
        company_id="company_123",
        type=["spend"],
        limit=50,
        cursor=cursor,
    )
    for txn in transactions:
        print(txn.id, txn.type)
    if len(transactions) == 50:
        cursor = transactions[-1].id
    else:
        break
```

(The SDK examples use `limit: 50`; pick any value 1–100. The cursor value is a
resource `id` — "the id of the resource after which to start fetching".)

## Webhook signature verification

Rain signs every webhook with **HMAC-SHA256, keyed on your API key value**
(the dual-use key above), and puts the lowercase hex digest in the `Signature`
header. Rain's documented verification example computes:

```ts
import { createHmac } from "crypto";

const signature = createHmac("sha256", YOUR_LATEST_API_KEY)
  .update(REQUEST_BODY_AS_JSON_STRING) // JSON.stringify(payload)
  .digest("hex");
// compare to the Signature header (constant-time) before processing
```

Compare your computed digest to the `Signature` header — and to
`Secondary-Signature` if present (key rotation) — using a **constant-time**
comparison. The full algorithm, a critical note on **what exact bytes to sign**
(re-serialized vs raw body), constant-time comparison in every language, and
the dual-use rotation story live in
[signature-verification.md](references/signature-verification.md).

No-network verifiers you can run now:
[`scripts/verify-webhook.js`](scripts/verify-webhook.js) and
[`verify-webhook.py`](scripts/verify-webhook.py).

> Receiving and processing the webhook lifecycle (registration, the envelope
> shape, the transaction state machine) belongs to
> [`rain-managed-authorizations`](../rain-managed-authorizations/SKILL.md) — it
> references this section rather than duplicating it.

## Logging (PII warning)

Set `RAIN_LOG=debug` to log requests/responses, or use the `logLevel` /
`log_level` client option (`'debug' | 'info' | 'warn' | 'error' | 'off'`).

```bash
RAIN_LOG=debug node app.js
RAIN_LOG=debug python app.py
```

Go differs — a single debug toggle, no levels:
`option.WithDebugLog(log.Default())` (or `option.WithDebugLog(nil)` for stderr).

> **PII warning.** Debug logging may expose sensitive request/response data
> (cardholder PII, and — in card-secret flows — decrypted card details). Use
> `debug` only in development; never ship it to production logs.

## What's next

- **Issue a card / run KYC / decrypt card secrets** →
  [`rain-issue-consumer-card`](../rain-issue-consumer-card/SKILL.md).
- **Receive spend webhooks & handle the transaction lifecycle** →
  [`rain-managed-authorizations`](../rain-managed-authorizations/SKILL.md)
  (it reuses the signature verifier here).
- **Any other Rain endpoint** →
  [`rain-api-generic`](../rain-api-generic/SKILL.md).

## See also

- [references/error-codes.md](references/error-codes.md) — status-to-cause
  table and 401 decision tree.
- [references/api-key-roles.md](references/api-key-roles.md) — roles, custom
  `resource:action` permissions, and `POST /issuing/keys`.
- [references/auth-pitfalls.md](references/auth-pitfalls.md) — `Api-Key` vs
  `Bearer`, 401 triage, the IP allowlist 401.
- [references/signature-verification.md](references/signature-verification.md) —
  HMAC-SHA256 webhook verification, the dual-use key, constant-time compare.
