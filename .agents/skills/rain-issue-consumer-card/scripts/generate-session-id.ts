/**
 * Generate a Rain card-secret `SessionId` header value.
 *
 * RSA-OAEP, OAEP hash = SHA-1, using the SessionId public key for your environment
 * (1024-bit — NOT the 2048-bit KYC key). Returns { secretKey, sessionId }:
 *   - sessionId : put in the `SessionId` header (get-secrets) or `sessionid` (scoped card)
 *   - secretKey : KEEP IT — it is the input to decrypt-card-secret.ts
 *
 * Two implementations:
 *   - generateSessionId(pem, secret?)         — Node (crypto module)
 *   - generateSessionIdWebCrypto(pem, secret?) — browser / Worker (Web Crypto API)
 *
 * Run (Node):  npx tsx generate-session-id.ts
 */

// ---------------------------------------------------------------------------
// SessionId public keys (1024-bit RSA). NOT the KYC keys.
// ---------------------------------------------------------------------------
export const DEV_SESSIONID_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCAP192809jZyaw62g/eTzJ3P9H
+RmT88sXUYjQ0K8Bx+rJ83f22+9isKx+lo5UuV8tvOlKwvdDS/pVbzpG7D7NO45c
0zkLOXwDHZkou8fuj8xhDO5Tq3GzcrabNLRLVz3dkx0znfzGOhnY4lkOMIdKxlQb
LuVM/dGDC9UpulF+UwIDAQAB
-----END PUBLIC KEY-----`;

export const PROD_SESSIONID_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCeZ9uCoxi2XvOw1VmvVLo88TLk
GE+OO1j3fa8HhYlJZZ7CCIAsaCorrU+ZpD5PUTnmME3DJk+JyY1BB3p8XI+C5uno
QucrbxFbkM1lgR10ewz/LcuhleG0mrXL/bzUZbeJqI6v3c9bXvLPKlsordPanYBG
FZkmBPxc8QEdRgH4awIDAQAB
-----END PUBLIC KEY-----`;

export interface SessionId {
  /** 32-char hex string. Keep for AES decryption. */
  secretKey: string;
  /** base64 RSA-OAEP ciphertext. Send as the SessionId/sessionid header. */
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Node implementation
// ---------------------------------------------------------------------------
import crypto from "node:crypto";

export function generateSessionId(pem: string, secret?: string): SessionId {
  if (!pem) throw new Error("pem is required (a SessionId public key, 1024-bit)");
  if (secret && !/^[0-9A-Fa-f]+$/.test(secret)) {
    throw new Error("secret must be a hex string");
  }

  // 32 hex chars = 16 random bytes. randomUUID minus dashes is exactly that.
  const secretKey = secret ?? crypto.randomUUID().replace(/-/g, "");

  // base64 of the 16 RAW bytes, then RSA-encrypt the UTF-8 bytes of THAT base64 string.
  const secretKeyBase64 = Buffer.from(secretKey, "hex").toString("base64");
  const ciphertext = crypto.publicEncrypt(
    {
      key: pem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha1",
    },
    Buffer.from(secretKeyBase64, "utf-8"),
  );

  return { secretKey, sessionId: ciphertext.toString("base64") };
}

// ---------------------------------------------------------------------------
// Browser / Web Crypto implementation (no Node crypto module)
// ---------------------------------------------------------------------------
export async function generateSessionIdWebCrypto(
  pem: string,
  secret?: string,
): Promise<SessionId> {
  if (!pem) throw new Error("pem is required");
  if (secret && !/^[0-9A-Fa-f]+$/.test(secret)) {
    throw new Error("secret must be a hex string");
  }

  const hexSecret =
    secret ??
    Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  // hex -> raw bytes -> base64 STRING
  const rawBytes = Uint8Array.from(
    hexSecret.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)),
  );
  const secretKeyBase64 = btoa(String.fromCharCode(...rawBytes));

  // strip PEM header/footer/newlines -> DER bytes
  const der = Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")),
    (c) => c.charCodeAt(0),
  );

  const key = await crypto.subtle.importKey(
    "spki",
    der,
    { name: "RSA-OAEP", hash: "SHA-1" },
    true,
    ["encrypt"],
  );

  const ct = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    key,
    new TextEncoder().encode(secretKeyBase64),
  );

  const sessionId = btoa(String.fromCharCode(...new Uint8Array(ct)));
  return { secretKey: hexSecret, sessionId };
}

// CLI demo (Node)
if (typeof require !== "undefined" && require.main === module) {
  const env = process.argv[2] === "prod" ? PROD_SESSIONID_PUBLIC_KEY : DEV_SESSIONID_PUBLIC_KEY;
  const out = generateSessionId(env);
  // Print only that we generated one; do not log secrets in real usage.
  console.log(JSON.stringify({ sessionId: out.sessionId, secretKeyLength: out.secretKey.length }));
}
