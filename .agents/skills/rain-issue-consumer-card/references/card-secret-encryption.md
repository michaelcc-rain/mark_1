# Card-secret encryption — the exact, corrected algorithm

This is the highest-risk, highest-value piece of the skill. Rain's published Node decrypt
snippet has a real bug; this document gives the corrected algorithm and explains exactly
why the official version returns garbage. The bundled `scripts/decrypt-card-secret.*`
implement the corrected version — prefer the scripts over re-deriving by hand.

## Table of contents

- [Overview](#overview)
- [Step A — Generate the SessionId (RSA-OAEP, SHA-1)](#step-a--generate-the-sessionid-rsa-oaep-sha-1)
- [Step B — Decrypt the secrets (AES-128-GCM)](#step-b--decrypt-the-secrets-aes-128-gcm)
- [The official Node snippet bug](#the-official-node-snippet-bug)
- [Why the WebCrypto version is already correct](#why-the-webcrypto-version-is-already-correct)
- [Browser WebCrypto reference](#browser-webcrypto-reference)
- [Which RSA key — SessionId vs KYC](#which-rsa-key--sessionid-vs-kyc)
- [Unit-test oracle](#unit-test-oracle)

## Overview

Two endpoints return encrypted card data: `GET /issuing/cards/{cardId}/secrets`
(header **`SessionId`**, PascalCase) and `POST /issuing/users/{userId}/cards/scoped`
(header **`sessionid`**, lowercase, inline in the create response). Both return the same
shape:

```json
{ "encryptedPan": { "iv": "<base64>", "data": "<base64>" },
  "encryptedCvc": { "iv": "<base64>", "data": "<base64>" } }
```

You decrypt each `{ iv, data }` with an AES-128-GCM key derived from a **session secret**
that you generated and shared with Rain (encrypted under Rain's RSA public key) in the
`SessionId` header. The round-trip:

1. You make a random 16-byte secret → hex string (`secretKey`, 32 hex chars).
2. You RSA-encrypt a transform of it under Rain's **SessionId** public key → that becomes
   the `SessionId` header value. Rain decrypts it server-side and uses it as the AES key.
3. Rain encrypts the PAN/CVC under AES-128-GCM with that key and returns `{ iv, data }`.
4. You decrypt locally with the **same** `secretKey` (hex-decoded to the 16-byte AES key).

## Step A — Generate the SessionId (RSA-OAEP, SHA-1)

1. `secret` = 32 hex chars = 16 random bytes hex-encoded. **Keep it** — you need it for
   decryption. (Default in Rain's docs: `crypto.randomUUID().replace(/-/g, "")`.)
2. Compute `b64 = base64( hexDecode(secret) )` — i.e. base64 of the 16 raw bytes.
3. RSA-encrypt the **UTF-8 bytes of the string `b64`** with:
   - padding **RSA-OAEP** (`RSA_PKCS1_OAEP_PADDING`),
   - OAEP hash **SHA-1** (`oaepHash: 'sha1'` in Node; `hash: "SHA-1"` in WebCrypto),
   - the **SessionId public key for your environment** (1024-bit; dev vs prod from
     [`sessionid-public-keys.md`](sessionid-public-keys.md)).
4. The `SessionId` header value = base64 of the RSA ciphertext.

The subtlety in step 2/3: it is **not** the raw secret bytes that get RSA-encrypted — it
is the **UTF-8 bytes of the base64 *string*** of those raw bytes. Getting this wrong means
Rain derives a different AES key and your decrypt silently fails.

Node reference (matches `scripts/generate-session-id.ts`):

```js
import crypto from "crypto";

function generateSessionId(pem, secret) {
  if (!pem) throw new Error("pem is required");
  if (secret && !/^[0-9A-Fa-f]+$/.test(secret)) throw new Error("secret must be hex");
  const secretKey = secret ?? crypto.randomUUID().replace(/-/g, "");
  const b64 = Buffer.from(secretKey, "hex").toString("base64");       // base64 of 16 raw bytes
  const ciphertext = crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
    Buffer.from(b64, "utf-8"),                                        // UTF-8 of the base64 STRING
  );
  return { secretKey, sessionId: ciphertext.toString("base64") };
}
```

## Step B — Decrypt the secrets (AES-128-GCM)

For each `{ iv, data }`:

1. `key` = `hexDecode(secret)` → exactly **16 bytes** (AES-128). NOT the UTF-8 of the hex
   string — the hex is decoded to bytes.
2. `iv` = `base64Decode(field.iv)` (12-byte GCM nonce as delivered).
3. `buf` = `base64Decode(field.data)`. The wire format is `ciphertext || 16-byte-tag`:
   - `authTag = buf[buf.length - 16 ..]` (the **last 16 bytes** = 128-bit GCM tag),
   - `ciphertext = buf[0 .. buf.length - 16]`.
4. AES-128-GCM decrypt: set the IV, **`setAuthTag(authTag)`**, then `update(ciphertext)` +
   **`final()`**. `final()` verifies the tag and throws on mismatch.
   - Do **not** feed the tag into `update`.
   - Do **not** skip `final()`.

Corrected Node reference (this is `scripts/decrypt-card-secret.ts`):

```js
import crypto from "crypto";

function decryptSecret(base64Data, base64Iv, secretKeyHex) {
  if (!base64Data) throw new Error("base64Data is required");
  if (!base64Iv) throw new Error("base64Iv is required");
  if (!secretKeyHex || !/^[0-9A-Fa-f]+$/.test(secretKeyHex))
    throw new Error("secretKey must be a hex string");

  const key = Buffer.from(secretKeyHex, "hex");        // 16 bytes → AES-128
  const iv  = Buffer.from(base64Iv, "base64");
  const buf = Buffer.from(base64Data, "base64");
  const tag        = buf.subarray(buf.length - 16);    // last 16 bytes = GCM tag
  const ciphertext = buf.subarray(0, buf.length - 16);

  const decipher = crypto.createDecipheriv("aes-128-gcm", key, iv);
  decipher.setAuthTag(tag);                            // <-- MISSING in the official snippet
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
  //                                                   ^^^^^^^^^^^^^^^^ final() verifies the tag
}
```

Call order (both fields):

```js
const pan = decryptSecret(secrets.encryptedPan.data, secrets.encryptedPan.iv, secretKey);
const cvc = decryptSecret(secrets.encryptedCvc.data, secrets.encryptedCvc.iv, secretKey);
```

Note the argument order: `decryptSecret(data, iv, secretKey)` — `data` first, then `iv`.

## The official Node snippet bug

Rain's published Node snippet (in `docs/using-encryption-outside-of-a-browser-environment.mdx`)
computes `ciphertext` and `authTag` but **never uses them**:

```js
// BUGGY — do not ship this
const ciphertext = secret.subarray(0, -tagLength);   // computed…
const authTag    = secret.subarray(-tagLength);      // …but never used
const cryptoKey  = crypto.createDecipheriv("aes-128-gcm", secretKeyBuffer, iv);
cryptoKey.setAutoPadding(false);
const decrypted  = cryptoKey.update(secret);         // decrypts the FULL buffer incl. the tag
return decrypted.toString("utf-8").trim();           // never calls setAuthTag() or final()
```

Three concrete defects:

1. **Never calls `setAuthTag(authTag)`** — GCM authentication is never set up. Tampering
   goes undetected.
2. **Runs `update(secret)` over the full buffer** — it decrypts the ciphertext **plus the
   16-byte tag** as if the tag were extra ciphertext. Because GCM is CTR-mode + GMAC, the
   leading bytes still decrypt to the right plaintext, but **16 trailing garbage bytes**
   (the tag XORed with keystream) are appended.
3. **Never calls `final()`** — the tag is never verified. (If you *had* set the tag,
   `final()` would throw "Unsupported state or unable to authenticate data" because the
   tag was consumed as ciphertext.)

The trailing `.trim()` is the only thing masking the 16 garbage bytes — and it only strips
**whitespace**. For a PAN/CVC the appended bytes are usually non-whitespace, so the buggy
function typically returns a value **16 bytes too long**. That is exactly the "decryption
returns extra characters / wrong length" symptom integrators hit.

## Why the WebCrypto version is already correct

`crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, secret)` treats the **last 16 bytes of
`secret` as the auth tag automatically**, verifies it, and returns only the plaintext. The
default WebCrypto GCM tag length is 128 bits (16 bytes), which matches the wire format. So
the browser snippet in Rain's docs is correct as published — and it serves as the
cross-check oracle for the Node fix.

## Browser WebCrypto reference

Also shipped as the browser variant inside `scripts/decrypt-card-secret.ts` (and usable
from any browser/Worker context, no Node `crypto`):

```js
async function decryptSecretWebCrypto(base64Data, base64Iv, secretKeyHex) {
  const data = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
  const iv   = Uint8Array.from(atob(base64Iv),   (c) => c.charCodeAt(0));
  const keyBytes = Uint8Array.from(secretKeyHex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data); // tag auto-handled
  return new TextDecoder().decode(plain);
}
```

The session-id generation has a browser equivalent too (hex→bytes→`btoa`→
`importKey("spki", …, {name:"RSA-OAEP", hash:"SHA-1"})`→`subtle.encrypt`); see
`scripts/generate-session-id.ts` for both Node and browser paths.

## Which RSA key — SessionId vs KYC

There are **two different Rain RSA keypairs**, and using the wrong one breaks card-secret
decryption with no clear error:

| Purpose | Key file | Size | SPKI header |
|---|---|---|---|
| **Card-secret SessionId** (this flow) | `resource-sessionid-keys.mdx` | **1024-bit** | `MIGf…` |
| KYC request payload encryption (different flow) | `kyc-encryption-public-keys.mdx` | **2048-bit** | `MIIBIjANBgkq…` |

For **card-secret decryption and scoped cards, always use the SessionId key** for your
environment ([`sessionid-public-keys.md`](sessionid-public-keys.md)). Encrypting under the
2048-bit KYC key means Rain (which holds only the SessionId private key) can't recover your
session secret → the AES key it derives is wrong → secrets "decrypt" to garbage with no
exception. This is the #1 silent failure in this flow.

## Unit-test oracle

The corrected `decrypt-card-secret` MUST round-trip. To self-check without live API calls,
encrypt a known plaintext yourself and assert the decrypt returns it exactly (no 16 trailing
bytes):

```js
import crypto from "crypto";
// build a known triple
const secretKey = "00112233445566778899aabbccddeeff";  // 16 bytes hex
const key = Buffer.from(secretKey, "hex");
const iv  = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-128-gcm", key, iv);
const known  = "4111111111111111";                     // test PAN
const ct  = Buffer.concat([cipher.update(known, "utf-8"), cipher.final()]);
const tag = cipher.getAuthTag();
const data = Buffer.concat([ct, tag]).toString("base64"); // ciphertext || tag
const ivB64 = iv.toString("base64");

// decrypt with the corrected function and assert
const out = decryptSecret(data, ivB64, secretKey);
console.assert(out === known && out.length === known.length, "round-trip failed");
```

Cross-check the same triple against `decryptSecretWebCrypto` — it must produce the identical
string. If the buggy snippet were used instead, `out.length` would be `known.length + 16`.
