#!/usr/bin/env node
/**
 * verify-webhook.js — Verify a Rain webhook HMAC-SHA256 signature. NO network.
 *
 * Rain signs each webhook with HMAC-SHA256 keyed on your API KEY VALUE (the
 * dual-use signing key) over the JSON payload, hex-encoded, and puts the digest
 * in the `Signature` header. This script recomputes it and constant-time
 * compares against `Signature` (and, if present, `Secondary-Signature`).
 *
 * NOTE ON WHAT TO SIGN: this follows Rain's documented example exactly —
 * HMAC over the body STRING. Pass the RAW request body string you received
 * (do not parse-then-restringify, or key order/whitespace may drift). See
 * references/signature-verification.md.
 *
 * Usage:
 *   # Verify a captured delivery (body from a file, sig from the header):
 *   RAIN_WEBHOOK_SIGNING_KEY=<key> \
 *     node verify-webhook.js --body ./payload.json --signature <hex> [--secondary <hex>]
 *
 *   # Built-in self-test (no key/args needed) — proves the algorithm round-trips:
 *   node verify-webhook.js --self-test
 *
 * Env:
 *   RAIN_WEBHOOK_SIGNING_KEY  the signing key value. Defaults to RAIN_API_KEY.
 */
'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');

/** Lowercase-hex HMAC-SHA256 of `body` keyed by `signingKey`. */
function computeSignature(body, signingKey) {
  const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
  return createHmac('sha256', signingKey).update(bodyString).digest('hex');
}

/** Constant-time hex comparison. Returns false on length mismatch / bad input. */
function hexEqual(expectedHex, receivedHex) {
  if (typeof receivedHex !== 'string' || receivedHex.length === 0) return false;
  let a, b;
  try {
    a = Buffer.from(expectedHex, 'hex');
    b = Buffer.from(receivedHex, 'hex');
  } catch {
    return false;
  }
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verify a Rain webhook.
 * @param {string} body        raw request body string
 * @param {string} signingKey  API key value used to sign
 * @param {string} signature   the `Signature` header
 * @param {string} [secondary] the `Secondary-Signature` header, if present
 * @returns {boolean}
 */
function verifyRainWebhook(body, signingKey, signature, secondary) {
  const expected = computeSignature(body, signingKey);
  return hexEqual(expected, signature) || (secondary != null && hexEqual(expected, secondary));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--body') out.bodyPath = argv[++i];
    else if (a === '--signature') out.signature = argv[++i];
    else if (a === '--secondary') out.secondary = argv[++i];
  }
  return out;
}

function selfTest() {
  // Deterministic round-trip: sign with a known key, then verify.
  // The body is a FIXED literal string (byte-for-byte), so this self-test
  // produces the same digest as verify-webhook.py's self-test — proving the
  // algorithm is identical across languages. (Hashing a re-serialized object
  // instead would drift between languages; see references/signature-verification.md.)
  const key = 'test_signing_key_value';
  const body =
    '{"id":"550e8400-e29b-41d4-a716-446655440000","resource":"transaction",' +
    '"action":"completed","version":"1.0.0","body":{"id":"txn_123456","type":"spend"}}';
  const sig = computeSignature(body, key);
  const ok = verifyRainWebhook(body, key, sig);
  const tampered = verifyRainWebhook(body + ' ', key, sig); // must NOT verify
  console.log('self-test signature:', sig);
  console.log('verify(correct):    ', ok ? 'PASS' : 'FAIL');
  console.log('verify(tampered):   ', tampered ? 'FAIL (should reject!)' : 'PASS (rejected)');
  process.exit(ok && !tampered ? 0 : 1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();

  const signingKey = process.env.RAIN_WEBHOOK_SIGNING_KEY || process.env.RAIN_API_KEY;
  if (!signingKey) {
    console.error('FAIL: set RAIN_WEBHOOK_SIGNING_KEY (or RAIN_API_KEY) to the signing key value.');
    process.exit(1);
  }
  if (!args.bodyPath || !args.signature) {
    console.error('Usage: node verify-webhook.js --body <file> --signature <hex> [--secondary <hex>]');
    console.error('   or: node verify-webhook.js --self-test');
    process.exit(1);
  }

  const body = fs.readFileSync(args.bodyPath, 'utf8');
  const ok = verifyRainWebhook(body, signingKey, args.signature, args.secondary);
  if (ok) {
    console.log('OK: signature verified. Safe to process the payload.');
    process.exit(0);
  }
  console.error('FAIL: signature did NOT verify. Do not process the payload.');
  console.error('  - Confirm the signing key is the one currently selected in the dashboard.');
  console.error('  - Confirm --body is the RAW bytes received (not re-serialized).');
  process.exit(1);
}

module.exports = { computeSignature, hexEqual, verifyRainWebhook };

if (require.main === module) main();
