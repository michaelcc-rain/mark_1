/**
 * Generate a Rain card-secret `SessionId` header value.
 *
 * RSA-OAEP, OAEP hash = SHA-512, using the SessionId public key for your environment
 * (2048-bit; NOT the KYC-payload key, which is a different 2048-bit keypair). Returns { secretKey, sessionId }:
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
// SessionId public keys (2048-bit RSA, RSA-OAEP/SHA-512). NOT the KYC keys.
// Source: Rain docs, "SessionId Public Keys (Development and Production)".
// ---------------------------------------------------------------------------
export const DEV_SESSIONID_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4LPy3Nlj7AiPUmCxQ2rG
Vb2PEr36xTz7Zqnoav9e6fWJzR+IPUpQqTerrrfQaNg6xAXhvNVuTbZfRHV0LDtX
cpco43nhupBMPzWbjIP2C0QlOXxD1NT9p0vuRBPLnT8z3JHnL7fWqx0dx3v6BeFq
hMo235xR68qLDDjFXIV0FOmI6x1SJS76MwwlAqRHsxSEWJix4WxuK4Z/RrqIuX5J
O1yRInG4ENBtFbUmc3CO6fVVUpuuSCMwFmFrxQKFcOdWIc2pzN8NDhvlbGRXg2N9
vX8g1OQt4F6WxX39C917niCksen2lqTWoaR6qoW3JxehivLsnWgfM3vWOrUTaH2L
OQIDAQAB
-----END PUBLIC KEY-----`;

export const PROD_SESSIONID_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAowLTDgfW/U8+2dy6Uu8L
hOnfjaW6YVriYqkmtZMoI86h1xonzf5cJ4BO9ejrdl2kTDtOFiNj7JcMWc35o5x+
zooA6AmRArl0HQV+Ir7wd5vF91107jKq2f1XB3HQA80UW61VWe1fhpSJwu1ye5k5
6Eqrgmg1R3ypmXuMVm5897z+w/zCQZ2IOqb3cVbrRdcte6028eUjVGrSVD/ooShg
Hh7BZ6p0GSzbJ2KbxOM4UfcAo3XCz0/VTnerbPdmHkaGVIElFOnxGXM8wEWueRQQ
DmdHnDe/o/kuyO5uSUc8fvso2V6iZC9b5PGADU4bbTtuVuUulLky3RwaACWA6q4Q
cwIDAQAB
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
  if (!pem) throw new Error("pem is required (a SessionId public key, 2048-bit)");
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
      oaepHash: "sha512",
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
    { name: "RSA-OAEP", hash: "SHA-512" },
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
