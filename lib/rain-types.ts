// View-model types derived directly from the Rain SDK client instance.
// The SDK only re-exports `Rain` + errors at the top level, so we pull the
// resource response types off the client's method signatures. Type-only —
// safe to import from both server and client modules (erased at compile time).
import type Rain from "rain-sdk";

export type Balances = Awaited<ReturnType<Rain["users"]["retrieveBalances"]>>;
export type Contract = Awaited<ReturnType<Rain["users"]["retrieveContracts"]>>[number];
export type Card = Awaited<ReturnType<Rain["cards"]["retrieve"]>>;
export type CardStatus = Card["status"];
export type Application = Awaited<ReturnType<Rain["applications"]["user"]["retrieve"]>>;
export type ApplicationStatus = Application["applicationStatus"];
export type Transaction = Awaited<ReturnType<Rain["transactions"]["list"]>>[number];
export type SpendTransaction = Extract<Transaction, { type: "spend" }>;
