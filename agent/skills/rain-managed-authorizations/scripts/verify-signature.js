// verify-signature.js — verify a Rain webhook signature (HMAC-SHA256).
//
// Scheme (identical to rain-api-auth's signature-verification reference):
//   signature = HMAC_SHA256(key = <YOUR_API_KEY_VALUE>, message = <RAW_REQUEST_BODY>).hex()
//
// IMPORTANT: HMAC over the RAW request body bytes EXACTLY as received — do NOT
// JSON.parse then re-stringify. Re-serializing can reorder keys / change
// whitespace and break the match. The API key value doubles as the webhook
// signing secret; rotating the key rotates webhook signing too.
//
// Compares against the `Signature` header, and falls back to
// `Secondary-Signature` (present during key rotation). Constant-time compare.
//
// Usage as a module:
//   const { verifyRainSignature } = require("./verify-signature.js");
//   const ok = verifyRainSignature(rawBody, req.headers, process.env.RAIN_API_KEY);
//
// Usage as a CLI (for testing against a saved payload):
//   RAIN_API_KEY=... node verify-signature.js <payload.json> <signature-hex> [secondary-hex]

"use strict";

const { createHmac, timingSafeEqual } = require("node:crypto");

/**
 * @param {Buffer|string} rawBody  Raw request body EXACTLY as received (no re-serialization).
 * @param {object} headers         Incoming headers (case-insensitive keys handled).
 * @param {string} apiKey          Your Rain API key value (the webhook signing secret).
 * @returns {boolean}              true iff Signature or Secondary-Signature matches.
 */
function verifyRainSignature(rawBody, headers, apiKey) {
  if (!apiKey) throw new Error("Missing API key (webhook signing secret).");

  const expectedHex = createHmac("sha256", apiKey).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expectedHex, "hex");

  // Headers may be supplied in any casing; normalize lookups.
  const get = (name) => {
    if (headers == null) return undefined;
    if (typeof headers.get === "function") return headers.get(name); // Fetch Headers
    const lower = name.toLowerCase();
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === lower) return headers[k];
    }
    return undefined;
  };

  for (const headerName of ["Signature", "Secondary-Signature"]) {
    const provided = get(headerName);
    if (!provided) continue;
    if (constantTimeHexEqual(provided, expectedBuf)) return true;
  }
  return false;
}

/** Constant-time compare of a hex string against an expected Buffer. */
function constantTimeHexEqual(providedHex, expectedBuf) {
  let providedBuf;
  try {
    providedBuf = Buffer.from(String(providedHex).trim(), "hex");
  } catch {
    return false;
  }
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

module.exports = { verifyRainSignature, constantTimeHexEqual };

// --- CLI -------------------------------------------------------------------
if (require.main === module) {
  const fs = require("node:fs");
  const [, , payloadPath, sigHex, secondaryHex] = process.argv;
  const apiKey = process.env.RAIN_API_KEY;

  if (!payloadPath || !sigHex) {
    console.error(
      "Usage: RAIN_API_KEY=... node verify-signature.js <payload.json> <signature-hex> [secondary-hex]\n" +
        "Tip: to GENERATE a signature for a sample payload, run:\n" +
        "  RAIN_API_KEY=... node -e \"const{createHmac}=require('crypto');" +
        "console.log(createHmac('sha256',process.env.RAIN_API_KEY)" +
        ".update(require('fs').readFileSync(process.argv[1])).digest('hex'))\" <payload.json>"
    );
    process.exit(2);
  }
  if (!apiKey) {
    console.error("Set RAIN_API_KEY (your API key value = webhook signing secret).");
    process.exit(2);
  }

  const rawBody = fs.readFileSync(payloadPath); // raw bytes, no parse
  const headers = { Signature: sigHex };
  if (secondaryHex) headers["Secondary-Signature"] = secondaryHex;

  const ok = verifyRainSignature(rawBody, headers, apiKey);
  console.log(ok ? "VALID — signature matches" : "INVALID — no matching signature");
  process.exit(ok ? 0 : 1);
}
