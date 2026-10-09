# SessionId public keys (card-secret encryption)

These are the RSA public keys you use to encrypt your session secret into the `SessionId`
(get-secrets) / `sessionid` (scoped card) header. Pick the one matching your environment.

Source: Rain docs → **"SessionId Public Keys (Development and Production)"** (docs.rain.xyz;
the page is behind the docs access code). As of 2026-10 Rain publishes **2048-bit RSA** keys
and specifies **RSA-OAEP with SHA-512**. The 1024-bit keys and the SHA-1 OAEP hash that earlier
versions of this skill shipped are no longer documented — do not use them.

> ⚠️ **These are the SessionId keys, NOT the KYC keys.** The KYC request-payload keys in
> `kyc-encryption-public-keys.mdx` are a **different keypair** used for a different flow. Both
> keypairs are now 2048-bit with the same `MIIBIjANBgkq…` SPKI header, so **key size no longer
> tells them apart** — compare the PEM body against the ones below. For card-secret decryption
> and scoped cards, **use these.** Encrypting under the KYC key fails *silently*: Rain can't
> recover your session secret, and the returned secrets won't decrypt with no exception
> thrown. See [`card-secret-encryption.md`](card-secret-encryption.md#which-rsa-key--sessionid-vs-kyc).

## Development / Sandbox SessionId key (2048-bit RSA)

Use with `https://api-dev.raincards.xyz/v1`.

```
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4LPy3Nlj7AiPUmCxQ2rG
Vb2PEr36xTz7Zqnoav9e6fWJzR+IPUpQqTerrrfQaNg6xAXhvNVuTbZfRHV0LDtX
cpco43nhupBMPzWbjIP2C0QlOXxD1NT9p0vuRBPLnT8z3JHnL7fWqx0dx3v6BeFq
hMo235xR68qLDDjFXIV0FOmI6x1SJS76MwwlAqRHsxSEWJix4WxuK4Z/RrqIuX5J
O1yRInG4ENBtFbUmc3CO6fVVUpuuSCMwFmFrxQKFcOdWIc2pzN8NDhvlbGRXg2N9
vX8g1OQt4F6WxX39C917niCksen2lqTWoaR6qoW3JxehivLsnWgfM3vWOrUTaH2L
OQIDAQAB
-----END PUBLIC KEY-----
```

## Production SessionId key (2048-bit RSA)

Use with `https://api.raincards.xyz/v1`.

```
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAowLTDgfW/U8+2dy6Uu8L
hOnfjaW6YVriYqkmtZMoI86h1xonzf5cJ4BO9ejrdl2kTDtOFiNj7JcMWc35o5x+
zooA6AmRArl0HQV+Ir7wd5vF91107jKq2f1XB3HQA80UW61VWe1fhpSJwu1ye5k5
6Eqrgmg1R3ypmXuMVm5897z+w/zCQZ2IOqb3cVbrRdcte6028eUjVGrSVD/ooShg
Hh7BZ6p0GSzbJ2KbxOM4UfcAo3XCz0/VTnerbPdmHkaGVIElFOnxGXM8wEWueRQQ
DmdHnDe/o/kuyO5uSUc8fvso2V6iZC9b5PGADU4bbTtuVuUulLky3RwaACWA6q4Q
cwIDAQAB
-----END PUBLIC KEY-----
```

## OAEP parameters

Encrypt the UTF-8 bytes of the **base64 of your 16 raw secret bytes** with:

- padding **RSA-OAEP** (`RSA_PKCS1_OAEP_PADDING`)
- OAEP hash **SHA-512** (`oaepHash: "sha512"` in Node; `hash: "SHA-512"` in WebCrypto;
  `hashes.SHA512()` for both `algorithm` and `mgf` in Python `cryptography`; `sha512.New()` in Go)
- the SessionId public key for your environment (above)

The ciphertext is 256 bytes (344 base64 characters). A 128-byte / 172-character result means a
1024-bit key was used — that is a legacy key, replace it.

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

Key size alone no longer distinguishes a SessionId key from a KYC key (both are 2048-bit).
Confirm the modulus matches the published SessionId key for your environment:

```bash
# fingerprint of the PEM you hold
echo "<paste PEM>" | openssl rsa -pubin -outform DER 2>/dev/null | openssl dgst -sha256
# fingerprint of the documented key (dev shown; swap in the prod block for production)
sed -n '/BEGIN PUBLIC KEY/,/END PUBLIC KEY/p' references/sessionid-public-keys.md | head -9 \
  | openssl rsa -pubin -outform DER 2>/dev/null | openssl dgst -sha256
```

Both lines must print the same digest. A `Public-Key: (1024 bit)` result from
`openssl rsa -pubin -text -noout` means you hold a legacy SessionId key — replace it.
