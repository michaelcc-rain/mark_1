import "server-only";

/**
 * Rain sandbox simulation endpoints. These live at `/v1/simulate/*` — NOT under
 * `/v1/issuing` — and are NOT part of the generated SDK, so we call them with a
 * hand-rolled fetch. Sandbox only (they return 404 in production).
 */
const SIMULATE_BASE = "https://api-dev.raincards.xyz/v1";

async function simulate<T = unknown>(path: string, body: unknown): Promise<T> {
  const apiKey = process.env.RAIN_API_KEY;
  if (!apiKey) throw new Error("RAIN_API_KEY is not set");

  const res = await fetch(`${SIMULATE_BASE}${path}`, {
    method: "POST",
    headers: {
      "Api-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const message =
      (json as { message?: string })?.message ?? `Simulation failed (${res.status})`;
    throw new Error(message);
  }
  return json as T;
}

export interface SimulateTxResult {
  transactionId: string;
  status: "authorized" | "declined" | "settled";
  declinedReason?: string;
  completionReason?: "SETTLEMENT" | "REFUND";
}

/** Fund a user's collateral contract so spending power increases. */
export function simulateCollateralFund(contractId: string, amountCents: number) {
  return simulate<{ transactionId: string }>("/simulate/collateral/fund", {
    contractId,
    currency: "rusd",
    amount: amountCents,
  });
}

/** Simulate a merchant authorization against a real card. */
export function simulateAuthorize(params: {
  cardId: string;
  amount: number;
  currency: string;
  merchantName: string;
  merchantCategoryCode: string;
  declineReason?: string;
}) {
  return simulate<SimulateTxResult>("/simulate/transactions/authorize", params);
}
