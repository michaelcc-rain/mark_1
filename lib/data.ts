import "server-only";
import { rain, isRainConfigured } from "./rain";
import { getUserId, getCardId } from "./session";
import type {
  Application,
  Balances,
  Contract,
  Card,
  SpendTransaction,
} from "./rain-types";

export interface AccountSnapshot {
  configured: boolean;
  userId: string | null;
  application: Application | null;
  balances: Balances | null;
  contract: Contract | null;
  card: Card | null;
}

/**
 * Read the whole account state in one shot for Server Components. Tolerant: any
 * individual Rain call can fail (e.g. contracts still provisioning) without
 * sinking the page — failed reads come back null.
 */
export async function getSnapshot(): Promise<AccountSnapshot> {
  const configured = isRainConfigured();
  const userId = await getUserId();

  const empty: AccountSnapshot = {
    configured,
    userId,
    application: null,
    balances: null,
    contract: null,
    card: null,
  };
  if (!configured || !userId) return empty;

  const client = rain();
  const cardId = await getCardId();

  const [appR, balR, conR, cardR] = await Promise.allSettled([
    client.applications.user.retrieve(userId),
    client.users.retrieveBalances(userId),
    client.users.retrieveContracts(userId),
    cardId
      ? client.cards.retrieve(cardId)
      : client.cards.list({ userId }).then((list) => list[0] ?? null),
  ]);

  return {
    configured,
    userId,
    application: appR.status === "fulfilled" ? appR.value : null,
    balances: balR.status === "fulfilled" ? balR.value : null,
    contract: conR.status === "fulfilled" ? (conR.value[0] ?? null) : null,
    card: cardR.status === "fulfilled" ? (cardR.value ?? null) : null,
  };
}

/** Card-spend transactions for the current user (newest first). */
export async function getSpendTransactions(): Promise<SpendTransaction[]> {
  const userId = await getUserId();
  if (!isRainConfigured() || !userId) return [];
  try {
    const list = await rain().transactions.list({ userId });
    return list.filter((t): t is SpendTransaction => t.type === "spend");
  } catch {
    return [];
  }
}

export type NextStep =
  | "kyc"
  | "wait-approval"
  | "issue-card"
  | "fund"
  | "ready";

/** Where the user is in the KYC → card → fund → spend funnel. */
export function nextStep(s: AccountSnapshot): NextStep {
  if (!s.userId) return "kyc";
  const status = s.application?.applicationStatus;
  if (status && status !== "approved") return "wait-approval";
  if (!s.card) return "issue-card";
  if (!s.balances || s.balances.spendingPower <= 0) return "fund";
  return "ready";
}
