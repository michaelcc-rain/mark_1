---
name: rain-api-generic
description: Catch-all fallback for any Rain card-issuing API task that does NOT match a more specific skill (balances, transfers, disputes, API-key management, the `/simulate/*` sandbox endpoints, reports, subtenants, contracts, signatures, anything else against `raincards.xyz`). TRIGGER when the user wants to call, inspect, or debug a Rain endpoint not otherwise covered. The procedure — locate the right endpoint via the Rain docs MCP (`mcp__rain-docs__*`) or the OpenAPI spec, read its request/response shape, build the payload, authenticate with the `Api-Key` header, and validate. SKIP whenever a narrower skill applies — authentication / SDK setup / idempotency / pagination / webhook signature verification → `rain-api-auth`; issuing a card + KYC + decrypting card secrets → `rain-issue-consumer-card`; receiving spend webhooks + the transaction lifecycle → `rain-managed-authorizations`.
allowed-tools: Read, Write, Bash, Grep
---

# Rain — generic API fallback

A skill of last resort. The Rain Issuing API has ~90 endpoints. The
OpenAPI 3.0.3 spec (`info.title: "Issuing API"`) is the source of truth —
read it before guessing.

⚠️ **Rain's OpenAPI spec is NOT served on a public URL.** The docs site
(`https://docs.rain.xyz`) is login-gated and redirects an unauthenticated
fetch of `openapi.json` to a login page. So unlike some vendors, the helper
scripts here do not auto-download the spec — you point them at a local copy
(see [step 0](#0-get-the-spec-locally-once)).

## When to invoke

The user is asking for *something* against `raincards.xyz` but none of the
specific skills apply. Examples:

- "Get the credit balance for a user / company / the whole tenant"
- "List or update a dispute, upload dispute evidence"
- "Create a programmatic API key with custom permissions"
- "Drive a sandbox transaction with the `/simulate/*` endpoints"
- "Fetch a single transaction by id and show me its fields"
- "Pull a report" / "manage a subtenant" / "list contracts or signatures"
- "What endpoint do I call to …?"

If the ask clearly matches one of:

- [`rain-api-auth`](../rain-api-auth/SKILL.md) — authentication, SDK install/init,
  the `Api-Key` header, `401`/`403` triage, error handling, retries, timeouts,
  idempotency, cursor pagination, and **HMAC-SHA256 webhook signature verification**.
- [`rain-issue-consumer-card`](../rain-issue-consumer-card/SKILL.md) — issuing a
  consumer card end-to-end: KYC application, document upload, card creation, and
  retrieving + decrypting the encrypted PAN/CVC (and scoped cards for AI agents).
- [`rain-managed-authorizations`](../rain-managed-authorizations/SKILL.md) — receiving
  and processing card **spend webhooks** for Rain-Managed programs, verifying the
  `Signature` header, and the full transaction lifecycle.

…use that instead. This skill exists for everything else.

## Auth

Every request carries the `Api-Key` header. **Sandbox keys only** — never paste
a production key to an agent. The helper script
`${CLAUDE_SKILL_DIR}/scripts/rain_curl.sh` reads `RAIN_API_KEY`, targets the
sandbox base URL (`https://api-dev.raincards.xyz/v1`) by default, and refuses to
hit production unless you explicitly set `RAIN_ALLOW_PROD=1`.

If the user has not supplied `RAIN_API_KEY`, stop and ask. For the full auth
reference (header vs `Authorization: Bearer`, key roles, IP allowlists, the
`401 "Address invalid for API key"` case), see
[`rain-api-auth`](../rain-api-auth/SKILL.md).

## Hard rule: no shotgun debugging

**Never guess endpoint paths.** Do not try `/issuing/balance`, then
`/issuing/balances`, then `/balances`, then `/v1/balances`, … The spec has the
exact paths — guessing is always slower and noisier than searching, and a wrong
path returns a `404` that tells you nothing. If `find_endpoint.py` returns no
matches, try a different keyword or read the spec directly. The only valid
reason to type a path is because the spec (or the docs MCP) told you it exists.

## Procedure

### 0. Get the spec locally (once)

The find/show helpers below read a **local** `openapi.json` because Rain's spec
is not public. Resolution order (first match wins), implemented in
`scripts/_schema_cache.py`:

1. `$RAIN_OPENAPI` — absolute path to a local spec file (preferred — set this).
2. `$RAIN_OPENAPI_URL` — fetch from a mirror *you* can reach (e.g. your own
   authenticated copy). Cached 24 h at `~/.cache/rain/openapi.json`.
3. An existing cache at `~/.cache/rain/openapi.json`.
4. Common local layouts (`./openapi.json`, `~/Desktop/rain-platform-docs/openapi.json`).

Get the spec by downloading `openapi.json` from the Rain developer docs while
signed in, or by asking your Rain contact for the current copy. Then:

```bash
export RAIN_OPENAPI=/abs/path/to/openapi.json
```

If you have the **Rain docs MCP** available in this session (tools named
`mcp__rain-docs__*`), prefer it for prose/lifecycle questions and cross-check
endpoint shapes against the spec. The spec remains the source of truth for
exact field names, types, and required/optional flags.

### 1. Search the spec — always

Before anything else, run:

```bash
${CLAUDE_SKILL_DIR}/scripts/find_endpoint.py <keyword>
```

Each argument is an AND-matched keyword (case-insensitive) against the path,
summary, tags, and `operationId`. You can mix in an HTTP method. Examples:

```bash
${CLAUDE_SKILL_DIR}/scripts/find_endpoint.py balances
${CLAUDE_SKILL_DIR}/scripts/find_endpoint.py simulate authorize
${CLAUDE_SKILL_DIR}/scripts/find_endpoint.py POST disputes
```

This is the **only** correct way to find an endpoint. Do not proceed to step 2
until you have a match from the spec.

### 2. Pick the right match

Output is `METHOD path  — summary  (operationId)`. Pick the best match from the
list `find_endpoint.py` returned. If any ambiguity remains, show the candidate
list to the user before committing. Watch for sibling paths that look alike —
e.g. `GET /issuing/balances` (whole tenant) vs `GET /issuing/users/{userId}/balances`
(one user) vs `GET /balances` (team-level account management). Pick by scope,
not by name.

### 3. Inspect the operation in full

Dump request params, body schema, and response shape:

```bash
${CLAUDE_SKILL_DIR}/scripts/show_endpoint.py GET /issuing/users/{userId}/balances
```

Read the schema; do not guess. Note in particular:

- **Path params** — substitute the real id before calling (`{userId}`,
  `{transactionId}`, `{disputeId}`, …).
- **Query params** — required vs optional; the `limit`/`cursor` pagination pair
  on list endpoints (`limit` is integer, min 1, max 100, default 20).
- **Required fields** in the request body (e.g. `POST /issuing/keys` requires
  `name` and `expiresAt`).
- **`security`** — virtually all endpoints use `ApiKeyAuth` (the `Api-Key`
  header). Flag anything different.
- **Cents vs dollars** — Rain monetary amounts are integer **minor units
  (cents)**, not decimals. Read the field description.

### 4. Build the payload

For writes, draft the JSON body and **show it to the user before sending**.
Spell out what each field means and any assumed defaults. Ask for confirmation
on anything irreversible (key creation/revocation, dispute submission, status
changes). Add an `Idempotency-Key` header to `POST`/`PUT`/`PATCH`/`DELETE`
create calls — see [`rain-api-auth`](../rain-api-auth/SKILL.md#idempotency).

### 5. Send

SDK-first — the official SDKs (TS `@rainapi/rain-sdk`, Go
`github.com/SignifyHQ/rain-sdk-go`, Python `rain-sdk`) cover most resources via
namespaces like `client.balances`, `client.disputes`, `client.keys`,
`client.transactions`. If a method exists for your endpoint, prefer it — it
handles auth, retries, and typed errors for you. See
[`rain-api-auth`](../rain-api-auth/SKILL.md) for install/init.

For anything the SDK doesn't expose (or any non-TS/Go/Python language), use the
authenticated curl wrapper — first-class, not a fallback:

```bash
${CLAUDE_SKILL_DIR}/scripts/rain_curl.sh GET  /issuing/users/abc123/balances
${CLAUDE_SKILL_DIR}/scripts/rain_curl.sh POST /issuing/keys key.json
echo '{"name":"limited","role":"readonly","expiresAt":"2027-01-01T00:00:00Z"}' \
  | ${CLAUDE_SKILL_DIR}/scripts/rain_curl.sh POST /issuing/keys -
```

The wrapper sets `Api-Key`, targets sandbox by default
(`RAIN_ENV=dev`), and prints `HTTP <code>` as its final line. Pass the
**resolved** path (real ids), not the `{template}`.

### 6. Validate

For state-changing calls, fetch the entity back and confirm the change landed.
Report any mismatch. For reads, surface the relevant fields — don't dump the
whole response. Rain list responses are **bare JSON arrays** (no
`data`/`nextCursor`/`hasMore` envelope), so to page you advance
`cursor = <id of the last item>` and stop when a page returns fewer than `limit`
items.

## Common pitfalls

- **Path-parameter expansion.** Substitute the real id into the path
  (`/issuing/users/abc123/balances`), never call the template
  (`/issuing/users/{userId}/balances`) — that returns a `404`.
- **Query-string encoding.** URL-encode values (`+` vs `%20`, commas in array
  filters). For repeated/array query params, check the spec for the expected
  format before assuming `?type=spend&type=refund` vs `?type=spend,refund`.
- **Pagination — no envelope.** List endpoints return a bare array. There is no
  `next_cursor`/`hasMore` field. Detect end-of-list with `len(page) < limit`;
  pass the last item's `id` as the next `cursor`. Don't claim "no results" from
  a single page. (Full loop in
  [`rain-api-auth`](../rain-api-auth/SKILL.md#pagination).)
- **Cents, not dollars.** Amounts are integer minor units. `5000` means $50.00.
- **Sandbox vs production base URL.** Sandbox is
  `https://api-dev.raincards.xyz/v1`; production is `https://api.raincards.xyz/v1`.
  The `/v1` is part of the base URL. The `rain_curl.sh` wrapper handles this;
  if you hand-build curl, include `/v1`.
- **The `/simulate/*` endpoints are sandbox-only and gated/beta.** They create
  real sandbox records and fire webhooks. The card must be `active` and belong
  to your tenant; fund collateral (`POST /simulate/collateral/fund`) first. For
  the spend-webhook lifecycle these drive, use
  [`rain-managed-authorizations`](../rain-managed-authorizations/SKILL.md).

## See also

- [`rain-api-auth`](../rain-api-auth/SKILL.md) — auth, SDK setup, errors,
  retries, idempotency, pagination, webhook signatures.
- [`rain-issue-consumer-card`](../rain-issue-consumer-card/SKILL.md) — card
  issuance, KYC, card-secret decryption.
- [`rain-managed-authorizations`](../rain-managed-authorizations/SKILL.md) —
  spend webhooks and the transaction lifecycle.
