"use server";

import { revalidatePath } from "next/cache";
import { getCardId } from "@/lib/session";
import { simulateAuthorize } from "@/lib/simulate";
import { errMsg } from "@/lib/errors";

export interface PurchaseInput {
  amountCents: number;
  merchantName: string;
  merchantCategoryCode: string;
  decline?: boolean;
}

export async function simulatePurchase(
  input: PurchaseInput,
): Promise<
  | { ok: true; status: string; declinedReason?: string }
  | { ok: false; error: string }
> {
  try {
    const cardId = await getCardId();
    if (!cardId) return { ok: false, error: "Issue a card first" };
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      return { ok: false, error: "Enter a valid amount" };
    }

    const res = await simulateAuthorize({
      cardId,
      amount: input.amountCents,
      currency: "USD",
      merchantName: input.merchantName || "Test Merchant",
      merchantCategoryCode: input.merchantCategoryCode || "5814",
      declineReason: input.decline ? "account_credit_limit_exceeded" : undefined,
    });

    revalidatePath("/transactions");
    revalidatePath("/dashboard");
    return { ok: true, status: res.status, declinedReason: res.declinedReason };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}
