"use server";

import { revalidatePath } from "next/cache";
import { rain } from "@/lib/rain";
import { getUserId } from "@/lib/session";
import { simulateCollateralFund } from "@/lib/simulate";
import { errMsg } from "@/lib/errors";

export async function fundCollateral(
  amountCents: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return { ok: false, error: "Enter a valid amount" };
    }
    const userId = await getUserId();
    if (!userId) return { ok: false, error: "Complete onboarding first" };

    const contracts = await rain().users.retrieveContracts(userId);
    const contract = contracts[0];
    if (!contract) {
      return {
        ok: false,
        error: "Your collateral account is still provisioning — try again shortly.",
      };
    }

    await simulateCollateralFund(contract.id, amountCents);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}
