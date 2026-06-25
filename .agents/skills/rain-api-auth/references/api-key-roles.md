# Rain API — key roles & custom permissions

How Rain API-key roles work, the full `resource:action` permission matrix for
`custom` keys, and the `POST /issuing/keys` create schema.

## Roles

Every key has a role. **If no role is provided, it defaults to `admin`.**

| Role | Description |
|---|---|
| `admin` | Full access to all API operations. |
| `readonly` | Read-only access to all resources. |
| `custom` | Granular permissions configured per resource (see below). |
| `webhookSigning` | Used **exclusively** for signing webhook payloads. |

## Custom permissions (`resource:action`)

A `custom` key carries a `permissions` array. Each entry is
`<resource>:<action>`. The array must contain **at least one** permission.

**Resources:**

| Resource | Covers |
|---|---|
| `applications` | User and company applications |
| `balances` | Balance information |
| `cardsAndShipping` | Card creation and shipping |
| `companies` | Company management |
| `users` | User management |
| `contractsAndSignatures` | Smart contracts and signatures |
| `payments` | Payment operations |
| `keys` | API key management |
| `reports` | Report access |
| `subtenants` | Subtenant management |
| `transactionsAndDisputes` | Transactions and disputes |
| `webhooks` | Webhook configuration |

**Actions:** `read` (view), `write` (create/update), `delete`.

Example permissions array:

```json
["transactionsAndDisputes:read", "cardsAndShipping:write"]
```

## Create a key — `POST /issuing/keys`

OperationId `createIssuingKey`. SDK: `client.keys`.

**Required:** `name`, `expiresAt`.

| Field | Type | Notes |
|---|---|---|
| `name` | string (required) | The name of the key. |
| `expiresAt` | string (required) | ISO-8601 expiry. Programmatic keys must expire in the future. |
| `role` | enum | `admin` / `readonly` / `custom` / `webhookSigning`. Defaults to `admin` if omitted. |
| `permissions` | string[] | `resource:action` entries. **Required if `role` is `custom`**; ignored for `admin`/`readonly`/`webhookSigning`. Must contain ≥ 1 entry. |
| `ipAddresses` | string[] | Optional IP allowlist, `maxItems: 100`. IPv4 / IPv6 / CIDR. If absent or empty, any IP is allowed. |

### Example payload

```json
{
  "name": "Limited access key",
  "role": "custom",
  "permissions": ["transactionsAndDisputes:read", "cardsAndShipping:write"],
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

### curl

```bash
curl -X POST "https://api-dev.raincards.xyz/v1/issuing/keys" \
     -H "Api-Key: ${RAIN_API_KEY}" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Limited access key",
       "role": "custom",
       "permissions": ["transactionsAndDisputes:read", "cardsAndShipping:write"],
       "expiresAt": "2027-01-01T00:00:00Z"
     }'
```

### SDK

```ts
const key = await client.keys.create({
  name: 'Limited access key',
  role: 'custom',
  permissions: ['transactionsAndDisputes:read', 'cardsAndShipping:write'],
  expiresAt: '2027-01-01T00:00:00Z',
});
```

```python
key = client.keys.create(
    name="Limited access key",
    role="custom",
    permissions=["transactionsAndDisputes:read", "cardsAndShipping:write"],
    expires_at="2027-01-01T00:00:00Z",
)
```

```go
key, err := client.Keys.New(context.TODO(), rainsdk.KeyNewParams{
	Name:        "Limited access key",
	Role:        rainsdk.String("custom"),
	Permissions: []string{"transactionsAndDisputes:read", "cardsAndShipping:write"},
	ExpiresAt:   "2027-01-01T00:00:00Z",
})
```

## Key-management constraints

- **Only PRIMARY keys can manage other keys.** You cannot create or revoke keys
  using a secondary key.
- Secondary (programmatic) keys must have a `name` and a future `expiresAt`.
- To **delete** a key that is currently set as the primary or secondary webhook
  signing key, first set a *different* signing key in the dashboard, then delete.

## Relationship to webhook signing

`webhookSigning`-role keys exist so you can dedicate a key to signing webhooks
instead of using your `admin` key. Remember the dual-use rule: **whichever key
is currently selected as the signing key is the HMAC secret Rain uses to sign
your webhooks.** See
[signature-verification.md](signature-verification.md) for verification and the
secondary-key rotation flow.
