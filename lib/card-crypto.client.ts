// Browser-only card-secret crypto. Copied (WebCrypto variants only) from the
// rain-issue-consumer-card skill scripts so the plaintext PAN/CVC only ever
// exist in the browser. Do NOT add a `node:crypto` import here — it would break
// the client bundle. Uses the global WebCrypto `crypto` (available in browsers).
//
// The DEV SessionId public key (1024-bit RSA) is a public sandbox constant — it
// is NOT the API key and NOT the KYC key, and is safe to ship to the client.

export const DEV_SESSIONID_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCAP192809jZyaw62g/eTzJ3P9H
+RmT88sXUYjQ0K8Bx+rJ83f22+9isKx+lo5UuV8tvOlKwvdDS/pVbzpG7D7NO45c
0zkLOXwDHZkou8fuj8xhDO5Tq3GzcrabNLRLVz3dkx0znfzGOhnY4lkOMIdKxlQb
LuVM/dGDC9UpulF+UwIDAQAB
-----END PUBLIC KEY-----`;

export interface SessionId {
  /** 32-char hex string. Keep for AES decryption; never send to the server. */
  secretKey: string;
  /** base64 RSA-OAEP ciphertext. Send as the `SessionId` value. */
  sessionId: string;
}

/** Generate a SessionId (RSA-OAEP, SHA-1) using a SessionId public key PEM. */
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

/**
 * AES-128-GCM decrypt a Rain card secret. WebCrypto verifies the trailing
 * 16-byte GCM auth tag automatically. NOTE arg order: (data, iv, secretKey).
 * SECURITY: never log the return value — render and discard.
 */
export async function decryptSecretWebCrypto(
  base64Data: string,
  base64Iv: string,
  secretKeyHex: string,
): Promise<string> {
  if (!base64Data) throw new Error("base64Data is required");
  if (!base64Iv) throw new Error("base64Iv is required");
  if (!secretKeyHex || !/^[0-9A-Fa-f]+$/.test(secretKeyHex)) {
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

  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(plain);
}
