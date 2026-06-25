# Application states — the `applicationStatus` state machine

Returned by `POST /issuing/applications/user` (in the `IssuingUser`/`IssuingApplication`
body) and by `GET /issuing/applications/user/{userId}`. This is the field you poll on
(Step 3) or read from the `user.updated` webhook.

## The full state table

The OpenAPI `ApplicationStatus` enum lists **8** values; the docs add `notStarted` and
`exempt` for **10** total. Handle all 10.

| Status | Terminal? | You must act? | Meaning |
|---|---|---|---|
| `approved` | yes | no | Application approved; cardholder created. Proceed to card creation. |
| `pending` | no | no | Automated checks are running. Wait. |
| `manualReview` | no | no | A Rain analyst is reviewing. Wait. |
| `notStarted` | no | maybe | Application created but processing hasn't begun. May need a redirect if you used the initiate endpoint. |
| `needsVerification` | no | **yes** | User must complete the identity verification flow. Redirect them to `applicationCompletionLink`. **Do NOT POST documents via the API in this state.** |
| `needsInformation` | no | **yes** | Documents were rejected; resubmission needed. Resubmit via the redirect or via the update endpoints. |
| `denied` | yes | no | Permanently denied. |
| `locked` | yes | no | Locked by Rain's compliance team. |
| `canceled` | yes | no | You canceled this application. |
| `exempt` | yes | no | Manually set by Rain for special cases. |

### Grouping for control flow

- **Terminal (stop polling):** `approved`, `denied`, `locked`, `canceled`, `exempt`.
- **Action-required (the user must do something):** `needsVerification`,
  `needsInformation`. Send them to the completion link; do not silently retry.
- **Transient (keep waiting, no action):** `pending`, `manualReview`, `notStarted`.

A correct poll loop treats only `approved` as success, throws/branches on the terminal
failures, surfaces the completion link on the two action-required states, and keeps
waiting on the transient three.

## Sumsub → Rain status mapping

Rain's KYC runs on Sumsub under the hood. The mapping (from `docs/application-states.mdx`):

| Sumsub reviewStatus / result | Rain `applicationStatus` |
|---|---|
| `reviewStatus = "init"` | `needsVerification` |
| `"onHold"` | `manualReview` |
| Completed + `GREEN` + `FINAL` | `approved` |
| Completed + `RED` + `FINAL` | `denied` |
| Completed + `RED` + `RETRY` | `needsInformation` |

This is why a freshly-created application that still needs the user to finish the hosted
flow shows `needsVerification`, and why a recoverable document problem shows
`needsInformation` (retry) while an unrecoverable one shows `denied` (final).

## `applicationCompletionLink`

When the application is in **any non-approved state**, the response includes an
`applicationCompletionLink` object:

```json
{
  "url": "https://verify.raincards.xyz/...",
  "params": { "userId": "550e8400-e29b-41d4-a716-446655440000" }
}
```

Schema: `required: ["url"]`; `url` is a URI; `params` is an object. The spec models only
`params.userId`, but the prose docs say `params` also carries a `signature`. **Pass every
returned param through unchanged** when you build the redirect URL — don't cherry-pick
`userId` — and append your own `redirect` query param so the user comes back to your app:

```ts
const link = new URL(app.applicationCompletionLink.url);
for (const [k, v] of Object.entries(app.applicationCompletionLink.params ?? {})) {
  link.searchParams.set(k, String(v));
}
link.searchParams.set('redirect', 'https://yourapp.example.com/kyc/done');
// redirect the user's browser to link.toString()
```

### Deprecated sibling

`applicationExternalVerificationLink` has the same `{ url, params: { userId } }` shape but
is **`deprecated: true`** in the spec. Some older docs reference it for `needsVerification`;
prefer `applicationCompletionLink`.

## Retrieving the current status

```bash
curl -sS "https://api-dev.raincards.xyz/v1/issuing/applications/user/$USER_ID" \
  -H "Api-Key: $RAIN_API_KEY" | jq '{status: .applicationStatus, link: .applicationCompletionLink}'
```

`GET /issuing/applications/user/{userId}` (operationId `getIssuingUserApplication`) returns
the application object. In the SDK: `client.applications.user.get(userId)` (TS/Python),
`client.Applications.User.Get(ctx, userID)` (Go).

## Webhook alternative (preferred for production)

Instead of polling, subscribe to the `user.updated` webhook and read `applicationStatus`
off the payload `body`. The `user.updated` event supports `eventReceivedAt` for ordering.
The receiver, signature verification, and idempotency-on-`id` all live in
[`rain-managed-authorizations`](../../rain-managed-authorizations/SKILL.md).
