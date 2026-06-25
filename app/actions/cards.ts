"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { rain } from "@/lib/rain";
import { getUserId, getCardId, setCardId } from "@/lib/session";
import { errMsg } from "@/lib/errors";

export async function issueCard(): Promise<
  { ok: true; cardId: string } | { ok: false; error: string }
> {
  try {
    const userId = await getUserId();
    if (!userId) return { ok: false, error: "Complete onboarding first" };

    const card = await rain().users.createCard(
      userId,
      {
        type: "virtual",
        limit: { amount: 50000, frequency: "per30DayPeriod" }, // $500 / rolling 30d
        configuration: { displayName: "RAIN MEMBER" },
      },
      { headers: { "Idempotency-Key": randomUUID() } },
    );

    await setCardId(card.id);
    revalidatePath("/card");
    revalidatePath("/dashboard");
    return { ok: true, cardId: card.id };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function setCardStatus(
  status: "active" | "locked",
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const cardId = await getCardId();
    if (!cardId) return { ok: false, error: "No card found" };
    await rain().cards.update(cardId, { status });
    revalidatePath("/card");
    revalidatePath("/transactions");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}
