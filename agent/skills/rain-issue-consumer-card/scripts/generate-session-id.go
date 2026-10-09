// Package cardcrypto generates a Rain card-secret SessionId header value.
//
// RSA-OAEP, OAEP hash = SHA-512, using the SessionId public key for your environment
// (2048-bit; NOT the KYC-payload key, which is a different 2048-bit keypair). Returns (secretKey, sessionId):
//   - sessionId : put in the `SessionId` header (get-secrets) or `sessionid` (scoped card)
//   - secretKey : KEEP IT — it is the input to DecryptSecret (decrypt-card-secret.go)
//
// Build/run as a standalone:  go run generate-session-id.go [dev|prod]
package cardcrypto

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha512"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"regexp"
)

// SessionId public keys (2048-bit RSA, RSA-OAEP/SHA-512). NOT the KYC keys.
// Source: Rain docs, "SessionId Public Keys (Development and Production)".
const DevSessionIDPublicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4LPy3Nlj7AiPUmCxQ2rG
Vb2PEr36xTz7Zqnoav9e6fWJzR+IPUpQqTerrrfQaNg6xAXhvNVuTbZfRHV0LDtX
cpco43nhupBMPzWbjIP2C0QlOXxD1NT9p0vuRBPLnT8z3JHnL7fWqx0dx3v6BeFq
hMo235xR68qLDDjFXIV0FOmI6x1SJS76MwwlAqRHsxSEWJix4WxuK4Z/RrqIuX5J
O1yRInG4ENBtFbUmc3CO6fVVUpuuSCMwFmFrxQKFcOdWIc2pzN8NDhvlbGRXg2N9
vX8g1OQt4F6WxX39C917niCksen2lqTWoaR6qoW3JxehivLsnWgfM3vWOrUTaH2L
OQIDAQAB
-----END PUBLIC KEY-----`

const ProdSessionIDPublicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAowLTDgfW/U8+2dy6Uu8L
hOnfjaW6YVriYqkmtZMoI86h1xonzf5cJ4BO9ejrdl2kTDtOFiNj7JcMWc35o5x+
zooA6AmRArl0HQV+Ir7wd5vF91107jKq2f1XB3HQA80UW61VWe1fhpSJwu1ye5k5
6Eqrgmg1R3ypmXuMVm5897z+w/zCQZ2IOqb3cVbrRdcte6028eUjVGrSVD/ooShg
Hh7BZ6p0GSzbJ2KbxOM4UfcAo3XCz0/VTnerbPdmHkaGVIElFOnxGXM8wEWueRQQ
DmdHnDe/o/kuyO5uSUc8fvso2V6iZC9b5PGADU4bbTtuVuUulLky3RwaACWA6q4Q
cwIDAQAB
-----END PUBLIC KEY-----`

var hexRe = regexp.MustCompile(`^[0-9A-Fa-f]+$`)

// GenerateSessionID returns (secretKeyHex, sessionIDBase64).
// Pass secret == "" to generate a fresh random 16-byte (32 hex char) secret.
func GenerateSessionID(pemStr, secret string) (string, string, error) {
	if pemStr == "" {
		return "", "", errors.New("pem is required (a SessionId public key, 2048-bit)")
	}
	if secret != "" && !hexRe.MatchString(secret) {
		return "", "", errors.New("secret must be a hex string")
	}

	// 32 hex chars = 16 random bytes
	secretKey := secret
	if secretKey == "" {
		buf := make([]byte, 16)
		if _, err := rand.Read(buf); err != nil {
			return "", "", err
		}
		secretKey = hex.EncodeToString(buf)
	}

	// base64 of the 16 RAW bytes, then RSA-encrypt the UTF-8 bytes of THAT base64 string
	raw, err := hex.DecodeString(secretKey)
	if err != nil {
		return "", "", err
	}
	secretKeyBase64 := []byte(base64.StdEncoding.EncodeToString(raw))

	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return "", "", errors.New("failed to decode PEM block")
	}
	pubAny, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return "", "", err
	}
	pub, ok := pubAny.(*rsa.PublicKey)
	if !ok {
		return "", "", errors.New("not an RSA public key")
	}

	ciphertext, err := rsa.EncryptOAEP(sha512.New(), rand.Reader, pub, secretKeyBase64, nil)
	if err != nil {
		return "", "", err
	}

	return secretKey, base64.StdEncoding.EncodeToString(ciphertext), nil
}
