/**
 * Decrypt a Rain encrypted card secret (PAN or CVC).
 *
 * CORRECTED AES-128-GCM. Rain's published Node snippet skips setAuthTag()/final() and
 * decrypts over the auth tag, leaving 16 trailing garbage bytes. This version:
 *   1. splits data into ciphertext (all but last 16 bytes) + authTag (last 16 bytes),
 *   2. calls setAuthTag(authTag),
 *   3. decrypts ONLY the ciphertext and calls final() (which verifies the tag).
 *
 * Inputs come from `GET /issuing/cards/{cardId}/secrets` (or the scoped-card response):
 *   { encryptedPan: { iv, data }, encryptedCvc: { iv, data } }
 * `secretKey` is the 32-char hex string returned by generate-session-id.
 *
 * Two implementations:
 *   - decryptSecret(data, iv, secretKey)          — Node (crypto module)
 *   - decryptSecretWebCrypto(data, iv, secretKey) — browser / Worker (Web Crypto API)
 *
 * NOTE arg order: (data, iv, secretKey) — `data` first, then `iv`.
 * SECURITY: never log the return value. Hand it to your secure surface and discard.
 */

import crypto from "node:crypto";

const HEX = /^[0-9A-Fa-f]+$/;

/** Node — corrected AES-128-GCM decrypt. */
export function decryptSecret(
  base64Data: string,
  base64Iv: string,
  secretKeyHex: string,
): string {
  if (!base64Data) throw new Error("base64Data is required");
  if (!base64Iv) throw new Error("base64Iv is required");
  if (!secretKeyHex || !HEX.test(secretKeyHex)) {
    throw new Error("secretKey must be a hex string");
  }

  const key = Buffer.from(secretKeyHex, "hex"); // 16 bytes -> AES-128
  const iv = Buffer.from(base64Iv, "base64");
  const buf = Buffer.from(base64Data, "base64");

  // Wire format is `ciphertext || 16-byte GCM tag`.
  const tag = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(0, buf.length - 16);

  const decipher = crypto.createDecipheriv("aes-128-gcm", key, iv);
  decipher.setAuthTag(tag); // <-- missing in Rain's official snippet
  // final() verifies the tag and throws on mismatch; do NOT skip it.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}

/** Browser / Worker — Web Crypto handles the trailing tag automatically. */
export async function decryptSecretWebCrypto(
  base64Data: string,
  base64Iv: string,
  secretKeyHex: string,
): Promise<string> {
  if (!base64Data) throw new Error("base64Data is required");
  if (!base64Iv) throw new Error("base64Iv is required");
  if (!secretKeyHex || !HEX.test(secretKeyHex)) {
    throw new Error("secretKey must be a hex string");
  }

  const data = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(base64Iv), (c) => c.charCodeAt(0));
  const keyBytes = Uint8Array.from(
    secretKeyHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)),
  );

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  // subtle.decrypt treats the last 16 bytes of `data` as the auth tag and verifies it.
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(plain);
}

// Self-test: round-trip a known plaintext (no live API needed).
//   npx tsx decrypt-card-secret.ts --selftest
if (typeof require !== "undefined" && require.main === module && process.argv.includes("--selftest")) {
  const secretKey = "00112233445566778899aabbccddeeff";
  const key = Buffer.from(secretKey, "hex");
  const iv = crypto.randomBytes(12);
  const known = "4111111111111111";
  const cipher = crypto.createCipheriv("aes-128-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(known, "utf-8"), cipher.final()]);
  const data = Buffer.concat([ct, cipher.getAuthTag()]).toString("base64");
  const out = decryptSecret(data, iv.toString("base64"), secretKey);
  if (out !== known || out.length !== known.length) {
    throw new Error(`round-trip failed: got "${out}" (len ${out.length})`);
  }
  console.log("self-test OK: round-trip exact, no trailing bytes");
}
