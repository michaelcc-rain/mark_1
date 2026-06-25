# Rain API — auth pitfalls & 401 triage

Every gotcha that produces a `401` (or a confusing `403`) against
`raincards.xyz`, and how to spot it. Read this when a smoke-test fails.

## `Api-Key` vs `Authorization: Bearer`

Both authenticate; **`Api-Key` is canonical** — lead with it.

```bash
# Canonical
curl -H "Api-Key: ${RAIN_API_KEY}" "https://api-dev.raincards.xyz/v1/companies"

# Also accepted
curl -H "Authorization: Bearer ${RAIN_API_KEY}" "https://api-dev.raincards.xyz/v1/companies"
```

Why `Api-Key` first:

- The Rain docs lead with it ("Every request … must include a valid API key in
  the `Api-Key` header").
- The OpenAPI spec declares two schemes — `ApiKeyAuth` (`Api-Key` header) and
  `bearerAuth` (HTTP bearer, `bearerFormat: JWT`) — but per-operation
  `security` references **only `ApiKeyAuth`**. Bearer works at the server but is
  not the declared scheme.

The SDKs always send `Api-Key`. You only choose a header when calling the REST
API directly.

### Pitfalls with the header itself

- **Wrong header name.** `ApiKey`, `X-Api-Key`, `Api_Key`, `APIKEY` are all
  ignored → `401`. It is exactly `Api-Key`.
- **Bearer prefix duplication.** With the bearer form the value is
  `Bearer <key>` — don't double the word (`Bearer Bearer ...`) and don't put a
  raw key in the `Authorization` header without the `Bearer ` prefix.
- **Quoting / whitespace.** A trailing newline or stray quote from a heredoc or
  copy-paste changes the key bytes → `401`. Verify with `printf '%s' "$RAIN_API_KEY" | wc -c`.

## 401 triage (in order)

1. **Message is `"Address invalid for API key"`** → IP allowlist, not a bad
   key. Jump to [the IP allowlist section](#ip-allowlist-401).
2. **Environment mismatch** → sandbox key against `api.raincards.xyz`, or prod
   key against `api-dev.raincards.xyz`. A key only works against the
   environment it was minted in.
   - `environment: 'dev'` ⟷ `https://api-dev.raincards.xyz/v1`
   - `environment: 'production'` ⟷ `https://api.raincards.xyz/v1`
3. **Key truncated / stale / has whitespace** → re-copy from the dashboard
   (**Config › API Keys**). Confirm `RAIN_API_KEY` holds the full value.
4. **Key expired or revoked** → programmatic keys carry `expiresAt`. Mint a new
   one.
5. **Header name/format** → see above.

## IP allowlist 401

If a key was created with an `ipAddresses` allowlist, any request from an IP not
in the list returns:

```
401 Unauthorized
"Address invalid for API key"
```

This message is the tell — it is **distinct** from a bad-key 401. Causes and
fixes:

- Your server's egress IP changed (autoscaling, new NAT gateway, container
  redeploy). Add the new IP/CIDR to the key.
- You're testing from a laptop whose IP isn't on the allowlist. Either add it,
  or use a key without an allowlist for local dev.
- A CIDR was entered too narrowly. Widen it (e.g. `203.0.113.0/24`).

To change the allowlist you must recreate the key with the desired
`ipAddresses` (set at creation). See
[api-key-roles.md](api-key-roles.md).

## 403, not 401

If you get `403 PermissionDeniedError`, the request **is** authenticated but the
key's role/permissions don't cover the operation:

- `readonly` key attempting a write/delete.
- `custom` key missing the needed `resource:action`.
- Using a **secondary** key to manage keys — only the **primary** key can
  create/revoke keys.

Fix with an `admin` key or by adding the right permission. See
[api-key-roles.md](api-key-roles.md) and
[error-codes.md](error-codes.md#403-vs-401).

## Webhook-signing key pitfalls

These bite when verifying webhooks (see
[signature-verification.md](signature-verification.md)):

- **Wrong key as the secret.** You must HMAC with the **currently selected
  signing key value**, not just "any API key". By default it's the tenant's
  auto-generated `admin` key.
- **Rotated the API key, forgot it was the signing key.** Revoking/replacing the
  signing key breaks signature verification for new webhooks. Use the
  secondary-key → promote rotation flow so both are valid during the cutover.
- **Verifying against the wrong header.** During rotation Rain may send
  `Secondary-Signature` in addition to `Signature` — accept either.

## Never expose keys client-side

- Never put a Rain API key in browser JavaScript, a mobile app bundle, or any
  client-distributed code — it grants full programmatic access (and is your
  webhook signing secret).
- Always use HTTPS. Plain `http://` can leak the key in transit.
- Keep keys in `.env` / `.claude/settings.local.json` / a secret manager — never
  commit them.

## See also

- [error-codes.md](error-codes.md) — typed errors and the 401 decision tree.
- [api-key-roles.md](api-key-roles.md) — roles and custom permissions.
- [signature-verification.md](signature-verification.md) — webhook signing key.
