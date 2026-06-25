/**
 * Create a Rain scoped (agent) card and decrypt its inline secrets (TypeScript).
 *
 * A scoped card is created and its encrypted secrets are returned in ONE call — no
 * separate get-secrets round-trip. Ideal for handing a single-purpose card to an AI agent.
 *
 * ⚠️ Gated: /cards/scoped must be enabled for your tenant during onboarding, or you get
 *    403 Forbidden. /cards/agentic is DEPRECATED — use /cards/scoped.
 * ⚠️ Header is lowercase `sessionid` for this endpoint (get-secrets uses PascalCase `SessionId`).
 *
 * Run (sandbox):
 *   export RAIN_API_KEY=<sandbox key>
 *   npx tsx issue-scoped-card.ts <approved-userId>
 */
import Rain from "@rainapi/rain-sdk";

import { generateSessionId, DEV_SESSIONID_PUBLIC_KEY } from "../scripts/generate-session-id";
import { decryptSecret } from "../scripts/decrypt-card-secret";

const client = new Rain({ apiKey: process.env["RAIN_API_KEY"], environment: "dev" });

async function main() {
  const userId = process.argv[2];
  if (!userId) throw new Error("usage: issue-scoped-card.ts <approved-userId>");

  // make a session id up front; keep the secretKey for decryption
  const { sessionId, secretKey } = generateSessionId(DEV_SESSIONID_PUBLIC_KEY);

  // $42.99 limit; lifetime cap is 1.2x = $51.59 (buffer configurable during onboarding)
  let scoped;
  try {
    scoped = await client.users.createScopedCard(
      userId,
      { amountInUSDCents: 4299 },
      { headers: { sessionid: sessionId } }, // lowercase for the scoped endpoint
    );
  } catch (err) {
    if (err instanceof Rain.PermissionDeniedError) {
      throw new Error("403: scoped cards are not enabled for this tenant — contact Rain to enable during onboarding");
    }
    throw err;
  }

  console.log("scoped card created:", scoped.id, "status:", scoped.status);
  // expirationMonth / expirationYear are STRINGS per the spec
  console.log("expires:", `${scoped.expirationMonth}/${scoped.expirationYear}`);

  // decrypt inline secrets — same SessionId key + AES-128-GCM as get-secrets
  try {
    const pan = decryptSecret(scoped.encryptedPan.data, scoped.encryptedPan.iv, secretKey);
    const cvc = decryptSecret(scoped.encryptedCvc.data, scoped.encryptedCvc.iv, secretKey);
    void cvc;
    console.log("scoped card ending", pan.slice(-4)); // never log the full PAN/CVC
  } catch {
    // Decryption is client-side, so the card exists even if this throws.
    // Retry retrieval with the returned id rather than re-issuing.
    console.error("decrypt failed; retry GET /issuing/cards/" + scoped.id + "/secrets with a fresh SessionId");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
