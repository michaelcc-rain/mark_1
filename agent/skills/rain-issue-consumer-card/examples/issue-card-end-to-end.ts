/**
 * Issue a Rain consumer card end-to-end (TypeScript).
 *
 *   1. create application  2. upload docs  3. await KYC
 *   4. create virtual card 5. retrieve + decrypt secrets
 *
 * Run (sandbox):
 *   export RAIN_API_KEY=<sandbox key>
 *   npx tsx issue-card-end-to-end.ts
 *
 * Uses the sandbox `approved`-last-name shortcut so KYC auto-approves.
 * Prints only last4 — never the full PAN/CVC.
 */
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import Rain from "@rainapi/rain-sdk";

import { generateSessionId, DEV_SESSIONID_PUBLIC_KEY } from "../scripts/generate-session-id";
import { decryptSecret } from "../scripts/decrypt-card-secret";

const client = new Rain({
  apiKey: process.env["RAIN_API_KEY"],
  environment: "dev", // 'production' for live
});

const TERMINAL_FAIL = ["denied", "locked", "canceled", "exempt"];
const ACTION_REQUIRED = ["needsVerification", "needsInformation"];

async function awaitApproval(userId: string, timeoutMs = 120_000, intervalMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const app = await client.applications.user.get(userId);
    const status = app.applicationStatus;
    if (status === "approved") return app;
    if (TERMINAL_FAIL.includes(status)) throw new Error(`terminal status: ${status}`);
    if (ACTION_REQUIRED.includes(status)) {
      // send the user to app.applicationCompletionLink (pass all params + a redirect)
      throw new Error(`action required (${status}): redirect user to applicationCompletionLink`);
    }
    await new Promise((r) => setTimeout(r, intervalMs)); // pending | manualReview | notStarted
  }
  throw new Error("timed out waiting for KYC");
}

async function main() {
  // 1. Create application (sandbox: lastName contains "approved" -> auto-approve)
  const application = await client.applications.user.create(
    {
      ipAddress: "203.0.113.10",
      occupation: "15-1252",
      annualSalary: "50000-100000",
      accountPurpose: "web3Payments",
      expectedMonthlyVolume: "1000-5000",
      isTermsOfServiceAccepted: true,
      // Rain-Managed only: one wallet field required
      walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
      firstName: "Jane",
      lastName: "Doe approved",
      birthDate: "1990-04-15",
      nationalId: "123456789",
      countryOfIssue: "US",
      email: `jane.doe.${Date.now()}@example.com`,
      address: { line1: "123 Main St", city: "New York", region: "NY", postalCode: "10001", countryCode: "US" },
    },
    { headers: { "Idempotency-Key": crypto.randomUUID() } },
  );
  const userId = application.id;
  console.log("application created:", userId, "status:", application.applicationStatus);

  // 2. Upload documents (skip if already approved via the sandbox shortcut)
  if (application.applicationStatus !== "approved" && process.env["UPLOAD_DOCS"]) {
    await client.applications.user.uploadDocument(userId, {
      document: createReadStream("./passport.png"),
      type: "passport",
      countryCode: "US",
    });
    await client.applications.user.uploadDocument(userId, {
      document: createReadStream("./selfie.jpg"),
      type: "selfie",
    });
  }

  // 3. Await KYC
  await awaitApproval(userId);
  console.log("KYC approved");

  // 4. Create a virtual card ($500 / rolling 30 days)
  const card = await client.users.createCard(
    userId,
    {
      type: "virtual",
      limit: { amount: 50_000, frequency: "per30DayPeriod" },
      configuration: { displayName: "JANE DOE" },
    },
    { headers: { "Idempotency-Key": crypto.randomUUID() } },
  );
  const cardId = card.id;
  console.log("card created:", cardId);

  // 5. Retrieve + decrypt secrets (SessionId key + AES-128-GCM)
  const { sessionId, secretKey } = generateSessionId(DEV_SESSIONID_PUBLIC_KEY);
  const secrets = await client.cards.getSecrets(cardId, { headers: { SessionId: sessionId } });
  const pan = decryptSecret(secrets.encryptedPan.data, secrets.encryptedPan.iv, secretKey);
  const cvc = decryptSecret(secrets.encryptedCvc.data, secrets.encryptedCvc.iv, secretKey);
  void cvc; // hand to your secure surface; never log it
  console.log("issued card ending", pan.slice(-4)); // never log the full PAN
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
