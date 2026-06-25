# SessionId public keys (card-secret encryption)

These are the RSA public keys you use to encrypt your session secret into the `SessionId`
(get-secrets) / `sessionid` (scoped card) header. Pick the one matching your environment.

> ⚠️ **These are the SessionId keys, NOT the KYC keys.** The KYC request-payload keys in
> `kyc-encryption-public-keys.mdx` are a **different keypair** (2048-bit, `MIIBIjANBgkq…`
> header). The SessionId keys below are **1024-bit** (`MIGf…` header). For card-secret
> decryption and scoped cards, **use these.** Encrypting under the KYC key fails *silently*
> — Rain can't recover your session secret, and the returned secrets won't decrypt with no
> exception thrown. See [`card-secret-encryption.md`](card-secret-encryption.md#which-rsa-key--sessionid-vs-kyc).

## Development / Sandbox SessionId key (1024-bit RSA)

Use with `https://api-dev.raincards.xyz/v1`.

```
-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCAP192809jZyaw62g/eTzJ3P9H
+RmT88sXUYjQ0K8Bx+rJ83f22+9isKx+lo5UuV8tvOlKwvdDS/pVbzpG7D7NO45c
0zkLOXwDHZkou8fuj8xhDO5Tq3GzcrabNLRLVz3dkx0znfzGOhnY4lkOMIdKxlQb
LuVM/dGDC9UpulF+UwIDAQAB
-----END PUBLIC KEY-----
```

## Production SessionId key (1024-bit RSA)

Use with `https://api.raincards.xyz/v1`.

```
-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCeZ9uCoxi2XvOw1VmvVLo88TLk
GE+OO1j3fa8HhYlJZZ7CCIAsaCorrU+ZpD5PUTnmME3DJk+JyY1BB3p8XI+C5uno
QucrbxFbkM1lgR10ewz/LcuhleG0mrXL/bzUZbeJqI6v3c9bXvLPKlsordPanYBG
FZkmBPxc8QEdRgH4awIDAQAB
-----END PUBLIC KEY-----
```

## Using them

The bundled scripts export these as constants so you don't paste PEMs by hand:

- `scripts/generate-session-id.ts` → `DEV_SESSIONID_PUBLIC_KEY`, `PROD_SESSIONID_PUBLIC_KEY`
- `scripts/generate-session-id.py` → `DEV_SESSIONID_PUBLIC_KEY`, `PROD_SESSIONID_PUBLIC_KEY`
- `scripts/generate-session-id.go` → `DevSessionIDPublicKey`, `ProdSessionIDPublicKey`

```ts
import { generateSessionId, DEV_SESSIONID_PUBLIC_KEY } from '../scripts/generate-session-id';
const { sessionId, secretKey } = generateSessionId(DEV_SESSIONID_PUBLIC_KEY);
```

If you keep keys outside source (recommended for prod), load the PEM from your secret store
and pass it as the `pem` argument — the function signature takes the PEM string directly.

## Sanity-check a PEM

A quick way to confirm you have a SessionId key (1024-bit) and not a KYC key (2048-bit):

```bash
echo "<paste PEM>" | openssl rsa -pubin -text -noout | head -1
# SessionId key  → "Public-Key: (1024 bit)"
# KYC key (wrong)→ "Public-Key: (2048 bit)"
```
