# Create-application fields — required vs optional, all `oneOf` variants

Endpoint: `POST /issuing/applications/user` (operationId `createIssuingUserApplication`).
Response `200` is an `IssuingUser`; **its `id` is the `userId`** for all later calls.

The request body schema is `allOf [ oneOf[ 3 variants ], commonObject ]`: you pick **one**
of three identity-supply variants, and the **common object applies to all three**.

## Common object — applies to EVERY variant

### Required (exactly these 5)

| Field | Type | Example | Notes |
|---|---|---|---|
| `ipAddress` | string | `"203.0.113.10"` | The user's IP address. |
| `occupation` | string | `"15-1252"` | SOC occupation code in Rain's examples. |
| `annualSalary` | string | `"50000-100000"` | A range string. |
| `accountPurpose` | string | `"web3Payments"` | |
| `expectedMonthlyVolume` | string | `"1000-5000"` | A range string. |

### Optional (common)

| Field | Type | Notes |
|---|---|---|
| `isTermsOfServiceAccepted` | boolean, `enum:[true]` | **Not required**, but if you send it, it must be `true`. Rain's own examples always send `true` — **recommended**. |
| `walletAddress` | string, `^0x[0-9a-fA-F]{40}$` | EVM address. **Rain-Managed requires one wallet field** (see below). |
| `solanaAddress` | string, `^[1-9A-HJ-NP-Za-km-z]{32,44}$` | Solana address. |
| `stellarAddress` | string, `^[GC][A-Z2-7]{55}$\|^M[A-Z2-7]{68}$` | Stellar address. |
| `chainId` | string | External collateral contracts only; not needed with Rain's collateral. |
| `contractAddress` | EVM/Solana address | External collateral only. |
| `sourceKey` | string, 1–24 chars | |
| `externalId` | string, 1–255 chars | Tenant-defined; **must be unique within your tenant.** |
| `hasExistingDocuments` | boolean | Reuse existing documents for additional verification. |

### Wallet rule for Rain-Managed (load-bearing)

> One of `walletAddress` / `solanaAddress` / `stellarAddress` **is required if you use a
> Rain-managed solution**, and not required otherwise.

Rain-Managed clients must have a wallet address for **each** user — it is the collateral
source the card draws against. Provision it before creating the application. Partner-Managed
clients can omit it.

> **Blocklisted wallet:** a blocklisted address makes the create call return
> `400 Bad Request` and rejects the application. Don't retry — get a different address.

## Variant 1 — Full PII ("Using API"): `IssuingApplicationPerson`

Supply identity fields directly. **Required:** `firstName`, `lastName`, `birthDate`,
`nationalId`, `countryOfIssue`, `email`, `address`.

| Field | Required | Type | Notes |
|---|---|---|---|
| `id` | no | uuid | A previously-initiated application's Rain ID, if any. |
| `firstName` | **yes** | string | |
| `lastName` | **yes** | string | Sandbox: contains `approved` ⇒ auto-approve. |
| `birthDate` | **yes** | date (`YYYY-MM-DD`) | |
| `nationalId` | **yes** | string | 9-digit SSN if `countryOfIssue` is US. |
| `countryOfIssue` | **yes** | `CountryCode` | |
| `email` | **yes** | string | |
| `phoneCountryCode` | **yes** | string `^[0-9]+$` | Digits only, no `+` — e.g. `"1"`. |
| `phoneNumber` | **yes** | string `^[0-9]+$` | Digits only, no separators — e.g. `"5125550100"`. |
| `address` | **yes** | `PhysicalAddress` | See below. |

> **Phone is required in practice.** The OpenAPI spec (and the generated SDK types) mark
> `phoneCountryCode`/`phoneNumber` as optional, but the sandbox **rejects the create call
> without them**. Always send both, digits only (`^[0-9]+$`) — e.g.
> `phoneCountryCode: "1"`, `phoneNumber: "5125550100"`.

`PhysicalAddress` requires `line1`, `city`, `postalCode`, `countryCode`; optional `line2`,
`region`.

## Variant 2 — Sumsub share token

Inline object, **required: `sumsubShareToken`**. Optional `sumsubShareTokenMode` enum:
`reusableKyc`, `sumsubIdConnect`, `copyApplicant` (defaults to the legacy applicant-copy
behavior if omitted). No PII in the body — the token carries it.

```json
{ "sumsubShareToken": "_act-sbx-...", "sumsubShareTokenMode": "reusableKyc",
  "ipAddress": "203.0.113.10", "occupation": "15-1252", "annualSalary": "50000-100000",
  "accountPurpose": "web3Payments", "expectedMonthlyVolume": "1000-5000" }
```

## Variant 3 — Persona share token

Inline object, **required: `personaShareToken`** (described as "The Persona inquiry ID").

```json
{ "personaShareToken": "inq_...", "ipAddress": "203.0.113.10", "occupation": "15-1252",
  "annualSalary": "50000-100000", "accountPurpose": "web3Payments",
  "expectedMonthlyVolume": "1000-5000" }
```

## Card-side fields (Step 4 reference)

Not part of the application, but commonly needed right after. `POST /issuing/users/{userId}/cards`:

- **Required:** `type` ∈ `virtual` | `physical`.
- `limit` (optional): `{ amount: integer-in-CENTS, frequency }`, both required if `limit`
  is present. `frequency` ∈ `per24HourPeriod`, `per7DayPeriod`, `per30DayPeriod`,
  `perYearPeriod`, `allTime`, `perAuthorization`.
- `configuration.displayName`: ≤26 chars, `^[a-zA-Z0-9 .-]+$`.
- `status` (optional): set `notActivated` to require activation. Statuses:
  `notActivated`, `active`, `locked`, `canceled`.
- `shipping` (physical only): `ShippingAddress` (`required: line1, city, postalCode,
  countryCode`; optional `line2`, `region`) **plus** `{ phoneNumber (required), method,
  firstName, lastName }`. `shipping.firstName`/`lastName`: `^[a-zA-Z -]+$`, 1–50 chars.
  `method` ∈ `standard`, `express`, `international`, `apc`, `uspsInternational`.
- `bulkShippingGroupId` (optional uuid from `/shipping-groups`).

### Per-tier card limits

| Tier | Total cards / user | Velocity (rolling 90 days) |
|---|---|---|
| Developer | 3 (active only) | 3 |
| Startup | 10 (all except canceled) | consumer 10 / corporate 50 |
| Enterprise consumer | 50 (all except canceled) | 50 |
| Enterprise corporate | 101 (incl. canceled) | no limit |

Hitting a limit returns `400`.
