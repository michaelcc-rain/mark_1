import { NextResponse } from "next/server";
import { rain, isRainConfigured } from "@/lib/rain";
import { getCardId } from "@/lib/session";

/**
 * Returns the still-encrypted PAN/CVC for the session's card. The browser holds
 * the AES secret key, so plaintext only ever exists client-side.
 *
 * Security: the cardId is read from the httpOnly cookie, NOT the request body or
 * URL — a caller cannot fetch secrets for an arbitrary card.
 */
export async function POST(request: Request) {
  if (!isRainConfigured()) {
    return NextResponse.json({ error: "Rain is not configured" }, { status: 503 });
  }

  let body: { sessionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const sessionId = body?.sessionId;
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const cardId = await getCardId();
  if (!cardId) {
    return NextResponse.json({ error: "No card on this session" }, { status: 400 });
  }

  try {
    const secrets = await rain().cards.retrieveSecrets(cardId, { SessionId: sessionId });
    return NextResponse.json({
      encryptedPan: secrets.encryptedPan,
      encryptedCvc: secrets.encryptedCvc,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to retrieve card secrets" },
      { status: 502 },
    );
  }
}
