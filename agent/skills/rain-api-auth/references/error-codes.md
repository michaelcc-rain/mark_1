# Rain API — error codes & 401 triage

Status-to-cause mapping for the Rain card-issuing API, the typed SDK error
classes, and a decision tree for the most common failure (`401`).

## Typed SDK error classes

The TS/Go/Python SDKs map HTTP status codes to typed errors. Catch the
specific class instead of inspecting the status by hand.

| Error class | Status | When it happens | Auto-retried by SDK? |
|---|---|---|---|
| `BadRequestError` | 400 | Missing or invalid parameters | No |
| `AuthenticationError` | 401 | Invalid or expired API key, wrong environment, or IP not allowed | No |
| `PermissionDeniedError` | 403 | Key lacks the required `resource:action` permission | No |
| `NotFoundError` | 404 | Resource doesn't exist (or wrong `userId`/`cardId`) | No |
| `ConflictError` | 409 | Conflicting concurrent update | **Yes** |
| `UnprocessableEntityError` | 422 | Valid syntax but the request can't be processed | No |
| `RateLimitError` | 429 | Too many requests, or concurrent idempotency-key collision | **Yes** |
| `InternalServerError` | 500+ | Server-side issue | **Yes** |

Connection errors, `408`, `409`, `429`, and `5xx` are retried up to 2 times by
default (configurable — see the main SKILL).

### Catching by class

```ts
import Rain from '@rainapi/rain-sdk';
try {
  await client.companies.list();
} catch (err) {
  if (err instanceof Rain.AuthenticationError) { /* 401 */ }
  if (err instanceof Rain.PermissionDeniedError) { /* 403 */ }
  if (err instanceof Rain.NotFoundError) { /* 404 */ }
  if (err instanceof Rain.RateLimitError) { /* 429 */ }
  throw err;
}
```

```python
from rain_sdk import Rain, AuthenticationError, NotFoundError, RateLimitError
try:
    client.companies.list()
except AuthenticationError:
    ...
except NotFoundError:
    ...
except RateLimitError:
    ...
```

```go
import "errors"
var apierr *rainsdk.Error
if errors.As(err, &apierr) {
	switch apierr.StatusCode {
	case 401: // auth
	case 403: // permission
	case 404: // not found
	case 429: // rate limit
	}
}
```

Every Go API error shares the type `*rainsdk.Error`; switch on
`apierr.StatusCode`.

## 401 decision tree

A `401` is the most common — and most ambiguous — failure. Walk it in order.

1. **Is the message `"Address invalid for API key"`?**
   → The request came from an IP not in the key's `ipAddresses` allowlist. Add
   the caller's egress IP/CIDR to the key, or use a key without an allowlist.
   This is *not* a bad-key error. See
   [auth-pitfalls.md](auth-pitfalls.md#ip-allowlist-401).

2. **Are you hitting the right environment?**
   → A sandbox key (`api-dev.raincards.xyz`) returns `401` against production
   (`api.raincards.xyz`) and vice versa. Confirm `environment: 'dev'` ⟷
   `https://api-dev.raincards.xyz/v1`, `environment: 'production'` ⟷
   `https://api.raincards.xyz/v1`.

3. **Is the key value exact?**
   → Copy-paste truncation, a trailing newline, or a stale value all yield
   `401`. Re-copy from the dashboard. The SDK reads `RAIN_API_KEY` by default —
   confirm the env var actually holds the value (`echo` it in a shell, never in
   committed code).

4. **Is the key expired or revoked?**
   → Programmatic keys carry an `expiresAt`. An expired key is a `401`. Mint a
   fresh one in the dashboard.

5. **Header name correct?**
   → Use `Api-Key: <value>` (canonical). `Authorization: Bearer <value>` also
   works. A misspelled header (e.g. `ApiKey`, `X-Api-Key`) is treated as no key
   → `401`.

## 403 vs 401

- `401 AuthenticationError` — the request is **not authenticated** (no/bad key,
  wrong env, blocked IP).
- `403 PermissionDeniedError` — the request **is authenticated** but the key's
  role/permissions don't cover the operation. Fix: use an `admin` key, or add
  the needed `resource:action` to a `custom` key. See
  [api-key-roles.md](api-key-roles.md).

## 404 on a card/user you just created

A `404 NotFoundError` on `/issuing/users/{userId}/cards` or
`/issuing/cards/{cardId}/...` usually means a wrong id, not a missing resource.
Cards are addressed by **`userId`** on the create path; the `cardId` is returned
in the create response. Double-check you're passing the right id type for the
path.

## See also

- [auth-pitfalls.md](auth-pitfalls.md) — full 401 triage, header choice, IP
  allowlist.
- [api-key-roles.md](api-key-roles.md) — roles and custom permissions behind
  `403`.
