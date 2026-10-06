// Browser-only Rain Wallet SDK glue. Import this ONLY from "use client" components.
// Do NOT add a `node:` import here — it would break the client bundle.
//
// The Rain wallet (`@rainxyz/wallet`) needs no app id, client key or environment: Rain's
// backend identity is embedded in the SDK. It owns login (email/SMS code), provisions one
// wallet (EVM + Solana accounts) on first login, and keeps the session in IndexedDB under a
// non-extractable WebCrypto key, shared across tabs of this origin.
//
// One RainProvider per page: the SDK holds a page-level client keyed on its settings and
// throws if a second RainProvider is constructed with different ones. Constructing it is
// cheap and touches no browser API until a method is called, so a module-scope instance is
// fine as long as this module is only reached from client components.

import {
  ProviderId,
  RainChain,
  RainProvider,
  RainSdk,
  type RainClient,
} from "@rainxyz/wallet";

/**
 * `RainSdk.build()` requires at least one RPC endpoint even though this app only reads the
 * wallet address. Base Sepolia is the sandbox chain the SDK's example app uses.
 */
const RPC_ENDPOINTS: Record<number, string> = {
  [RainChain.baseSepolia]: "https://base-sepolia-rpc.publicnode.com",
};

/** The single Rain wallet provider for this page. Passkeys are off: email login codes only. */
export const rainWallet = new RainProvider({
  passkeyDomain: null,
  onSessionExpired: () => {
    // TODO(design): react to a session the SDK could not refresh — decide: surface a
    // "please log in again" state to the wallet step vs. silently let the next action fail
    // (the wallet step reads `authState` reactively, so it will already flip to
    // "unauthenticated"; is a separate callback-driven message worth the extra wiring?)
  },
});

/**
 * Builds the SDK around `rainWallet` and resolves the Rain client. Requires an active
 * session: without one, resolving the provider rejects with `RAIN_201` (tokenExpired).
 */
export async function openWalletClient(): Promise<RainClient> {
  // TODO(design): the built RainSdk/RainClient lifetime — decide: cache at module scope and
  // reuse across calls vs. rebuild on every call (the SDK caches `provider()` resolution per
  // RainSdk instance, but `build()` is not free; a module cache also outlives `logout()`
  // unless it is cleared there, and the SDK's example app closes and rebuilds on reset)
  const sdk = await RainSdk.builder()
    .rpcEndpoints(RPC_ENDPOINTS)
    .register(rainWallet)
    .build();
  return sdk.provider(ProviderId.rain);
}

/** The wallet's EVM address (EIP-55 checksummed), shared across every supported EVM chain. */
export async function readEvmAddress(client: RainClient): Promise<string> {
  return client.getWalletAddress();
}
