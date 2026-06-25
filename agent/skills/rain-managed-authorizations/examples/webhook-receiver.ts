/**
 * webhook-receiver.ts — runnable Rain spend-webhook receiver (Express).
 *
 * Pipeline: verify signature → dedupe on envelope id → order by eventReceivedAt
 *           → route by action → return 200 FAST (heavy work goes async).
 *
 * Run:
 *   npm install express
 *   RAIN_API_KEY=sk_dev_... npx tsx webhook-receiver.ts   # or compile with tsc
 *   # expose publicly (loopback is blocked by Rain): ngrok http 3000
 *   # register the ngrok https URL in the Rain developer dashboard.
 *
 * Rain-Managed: you CANNOT approve/decline. `transaction.requested` only shows
 * up in sandbox — this receiver ignores it. `transaction.created` is the truth.
 */

import crypto from "node:crypto";
import express, { type Request, type Response } from "express";

const RAIN_API_KEY = process.env.RAIN_API_KEY; // doubles as the webhook signing secret
if (!RAIN_API_KEY) {
  throw new Error("Set RAIN_API_KEY (your API key value = webhook signing secret).");
}

const app = express();

// CRITICAL: capture the RAW body. Do NOT use express.json() on this route —
// the signature is HMAC over the exact bytes Rain sent. Re-serializing breaks it.
app.use("/webhooks/rain", express.raw({ type: "*/*" }));

// ---------------------------------------------------------------------------
// Types (subset of the payload — see references/webhook-payloads.md for the
// full field tables).
// ---------------------------------------------------------------------------
interface RainEnvelope {
  id: string; // delivery id (UUID) — DEDUPE KEY
  resource: string; // "transaction"
  action: "requested" | "created" | "updated" | "completed";
  version: string;
  eventReceivedAt?: string; // optional; OFF by default for spend
  body: {
    id: string; // transaction id — STABLE across the lifecycle
    type: "spend" | "collateral" | "payment";
    spend?: SpendBody;
  };
}

interface SpendBody {
  amount: number; // integer cents; negative for refunds
  currency: string;
  status: "pending" | "reversed" | "declined" | "completed";
  declinedReason?: string;
  authorizationUpdateAmount?: number; // signed: + increment, - reversal
  completionReason?: string;
  cardId: string;
  userId: string;
  merchantName?: string;
  postedAt?: string;
  isForcePosted?: boolean;
  closedAuthorizationTransactionId?: string;
}

// ---------------------------------------------------------------------------
// Step 2 — signature verification (raw body, constant-time, secondary fallback).
// Mirrors scripts/verify-signature.js and the rain-api-auth scheme.
// ---------------------------------------------------------------------------
function verifyRainSignature(rawBody: Buffer, headers: Request["headers"], apiKey: string): boolean {
  const expected = crypto.createHmac("sha256", apiKey).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  for (const headerName of ["signature", "secondary-signature"] as const) {
    const provided = headers[headerName];
    if (!provided || Array.isArray(provided)) continue;
    let providedBuf: Buffer;
    try {
      providedBuf = Buffer.from(provided.trim(), "hex");
    } catch {
      continue;
    }
    if (providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Step 4 — idempotency (dedupe on envelope id) + ordering helpers.
// Swap these in-memory stores for Redis / your DB in production.
// ---------------------------------------------------------------------------
const processedDeliveryIds = new Set<string>(); // envelope.id — already handled
const lastEventTimeByTxn = new Map<string, number>(); // body.id -> latest eventReceivedAt (ms)

function alreadyProcessed(deliveryId: string): boolean {
  if (processedDeliveryIds.has(deliveryId)) return true;
  processedDeliveryIds.add(deliveryId);
  return false;
}

/**
 * Returns false if this event is OLDER than one we already applied for the same
 * transaction (out-of-order late arrival). Only meaningful when eventReceivedAt
 * is present — it is OFF by default for spend (enable via your account manager).
 * Without it, design handlers to be order-tolerant (upsert by body.id; completed
 * is terminal).
 */
function isInOrder(txnId: string, eventReceivedAt?: string): boolean {
  if (!eventReceivedAt) return true; // can't order; tolerate
  const ts = Date.parse(eventReceivedAt); // ISO 8601 UTC ("Z")
  if (Number.isNaN(ts)) return true;
  const last = lastEventTimeByTxn.get(txnId);
  if (last !== undefined && ts < last) return false; // stale
  lastEventTimeByTxn.set(txnId, ts);
  return true;
}

// ---------------------------------------------------------------------------
// Step 5 — routing. Enqueue real work; keep this fast.
// ---------------------------------------------------------------------------
function routeEvent(env: RainEnvelope): void {
  if (env.body.type !== "spend" || !env.body.spend) return;
  const s = env.body.spend;
  const txnId = env.body.id;

  switch (env.action) {
    case "requested":
      // Rain-Managed: NOT delivered in production. Sandbox-only artifact. Ignore.
      console.log(`[ignore] requested (sandbox artifact) txn=${txnId}`);
      return;

    case "created":
      if (s.status === "declined") {
        console.log(`[declined] txn=${txnId} reason="${s.declinedReason ?? ""}"`);
      } else if (s.amount < 0) {
        console.log(`[refund-auth] txn=${txnId} amount=${s.amount} (no credit until settled)`);
      } else {
        console.log(`[auth] txn=${txnId} amount=${s.amount} ${s.currency} merchant="${s.merchantName ?? ""}"`);
      }
      // PERSIST every created (incl. declines) so updated/completed can reconcile.
      return;

    case "updated":
      if (s.status === "reversed") {
        const kind = s.amount === 0 ? "full" : "partial";
        console.log(`[reversal:${kind}] txn=${txnId} newTotal=${s.amount} delta=${s.authorizationUpdateAmount} (hold MAINTAINED)`);
      } else if (s.status === "declined") {
        console.log(`[declined-after-auth] txn=${txnId} reason="${s.declinedReason ?? ""}"`);
      } else {
        console.log(`[incremental] txn=${txnId} newTotal=${s.amount} delta=${s.authorizationUpdateAmount}`);
      }
      return;

    case "completed":
      console.log(`[completed] txn=${txnId} settled=${s.amount} reason=${s.completionReason} postedAt=${s.postedAt}`);
      if (s.isForcePosted) {
        console.log(`  force-posted; closedAuth=${s.closedAuthorizationTransactionId ?? "n/a"}`);
      }
      return;
  }
}

// ---------------------------------------------------------------------------
// The endpoint.
// ---------------------------------------------------------------------------
app.post("/webhooks/rain", (req: Request, res: Response) => {
  const rawBody = req.body as Buffer; // express.raw() → Buffer

  // Step 2: verify before doing anything.
  if (!verifyRainSignature(rawBody, req.headers, RAIN_API_KEY!)) {
    return res.status(401).json({ error: "invalid signature" });
  }

  let env: RainEnvelope;
  try {
    env = JSON.parse(rawBody.toString("utf8")) as RainEnvelope; // parse AFTER verifying
  } catch {
    return res.status(400).json({ error: "invalid JSON" });
  }

  // Step 4: dedupe on the envelope delivery id.
  if (alreadyProcessed(env.id)) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  // Step 4: drop stale out-of-order events (when eventReceivedAt is present).
  if (!isInOrder(env.body.id, env.eventReceivedAt)) {
    return res.status(200).json({ received: true, stale: true });
  }

  // Step 5: enqueue for async processing, then ack fast. (Here we route inline
  // for the example; in production push to a queue and return immediately.)
  setImmediate(() => {
    try {
      routeEvent(env);
    } catch (err) {
      console.error("processing error", err); // already acked; retry via your own DLQ
    }
  });

  // Step 3: ack fast with JSON (never HTML — Rain truncates non-JSON responses).
  return res.status(200).json({ received: true });
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => console.log(`Rain webhook receiver listening on :${PORT}/webhooks/rain`));
