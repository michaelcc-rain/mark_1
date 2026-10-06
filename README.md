# Aurora — a stablecoin neobank on Rain

A basic-UI demo neobank built on the [Rain](https://rain.xyz) card-issuing platform
(sandbox). It walks a consumer cardholder through the full journey:

**create wallet → KYC → issue card → fund → spend.**

Built with Next.js (App Router) + TypeScript + Tailwind v4, talking to the real Rain
sandbox API via the local `rain-sdk`. The Rain API key is a server-side secret and never
reaches the browser. The user's wallet is an embedded Rain wallet created in the browser
with the Rain Wallet SDK (`@rainxyz/wallet`), so the app never holds key material either.

## Prerequisites

- Node 24, pnpm
- A **sandbox `RAIN_API_KEY`** for a Rain-Managed consumer tenant (Rain Dashboard → Config,
  `https://www.use-dev.raincards.xyz`)
  - Tenant config: Consumer Card Program, Rain-managed authorization flow, Rain-managed compliance.

## Setup

```bash
cp .env.example .env.local      # then paste your sandbox key into RAIN_API_KEY
pnpm install
pnpm dev                        # http://localhost:3000
```

Without a key the app still runs and shows a "Connect Rain" setup banner.

### The Rain Wallet SDK (`vendor/`)

`@rainxyz/wallet`, `@rainxyz/react` and their internals are not on npm yet. They are vendored
as tarballs in `vendor/` (committed, so a fresh clone installs with no sibling checkout) and
wired in via `file:` dependencies plus `pnpm.overrides`. To rebuild them from the sibling
`../rain-sdk-react` checkout after an SDK change:

```bash
pnpm sdk:pack                   # builds the SDK, repacks vendor/*.tgz, rewrites package.json, pnpm install
```

Tarball names carry a content hash, so every repack is a new specifier and pnpm never trips
over a changed tarball under an old name.

## The flow

0. **Wallet** — enter an email, get a one-time code, verify. The Rain Wallet SDK creates an
   embedded wallet (EVM + Solana accounts) on first sign-in and the page reads its EVM
   address. The session lives in IndexedDB, so a reload restores the same wallet.
1. **Onboarding** — fill the KYC form. The wallet's EVM address is sent as `walletAddress`
   on the application, so Rain deploys the collateral contract with that wallet as owner.
   The last name defaults to **“Approved”**, which triggers sandbox auto-approval. The page
   polls until the application is `approved`.
2. **Card** — issue a virtual card ($500 / rolling-30-day limit). “Reveal card details”
   decrypts the PAN/CVC **in the browser** (the server never sees plaintext).
3. **Dashboard** — see spending power and your collateral deposit address. Use
   **Simulate funding** to add sandbox collateral; spending power updates.
4. **Transactions** — **Simulate a purchase** (or a decline). It appears in your activity.
   Freezing the card on the Card screen makes subsequent purchases decline.

## Architecture

- `lib/rain.ts` — server-only Rain SDK singleton (`environment: 'dev'`).
- `lib/simulate.ts` — sandbox `/v1/simulate/*` endpoints (not in the SDK; raw `fetch`).
- `lib/data.ts` — read aggregation for Server Components + the funnel state machine.
- `lib/card-crypto.client.ts` — browser-only WebCrypto (RSA-OAEP + AES-128-GCM) for card reveal.
- `lib/rain-wallet.client.ts` — browser-only Rain Wallet SDK glue: the page's single
  `RainProvider`, the `RainSdk` build, and the EVM address read. `components/WalletStep.tsx`
  is the login-code UI on top of it (`useRainWalletAuth` from `@rainxyz/react`).
- `app/actions/*` — Server Actions for mutations (`revalidatePath` after each).
- `app/api/card/secrets/route.ts` — returns encrypted PAN/CVC; reads the card id from the
  httpOnly cookie (never the request), so secrets can't be requested for an arbitrary card.

## Notes & caveats

- **Sandbox only.** The “Approved” auto-approve shortcut and every `/simulate/*` call return
  404/no-op in production — gate or remove them before going live.
- **No app auth.** A single active user is tracked by httpOnly cookies (`rain_user_id`,
  `rain_card_id`). “Start over” clears them. The wallet session is separate: it lives in the
  browser's IndexedDB and is not cleared by “Start over”, so the next onboarding run reuses
  the same wallet unless you log out of it.
- **Wallet backend is sandbox.** The Rain Wallet SDK's embedded backend identity is Rain's
  sandbox auth proxy, which allow-lists origins. If `Send code` fails from
  `http://localhost:3000`, run `pnpm dev -- -p 5173` (the origin the SDK's own demo uses) or
  ask Rain to add your origin.
- **No Solana address yet.** Only `walletAddress` (EVM) is registered. The wallet also has a
  Solana account (`client.getWalletAddress(RainChain.solanaDevnet)`) to send as
  `solanaAddress` when the program supports Solana collateral.
- **Velocity limit.** The dev tier allows only 3 cards / 90 days — reuse the issued card.
- Decrypted card secrets are rendered then discarded; they are never logged or persisted.
