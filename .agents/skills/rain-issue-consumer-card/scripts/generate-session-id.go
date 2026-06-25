// Package cardcrypto generates a Rain card-secret SessionId header value.
//
// RSA-OAEP, OAEP hash = SHA-1, using the SessionId public key for your environment
// (1024-bit — NOT the 2048-bit KYC key). Returns (secretKey, sessionId):
//   - sessionId : put in the `SessionId` header (get-secrets) or `sessionid` (scoped card)
//   - secretKey : KEEP IT — it is the input to DecryptSecret (decrypt-card-secret.go)
//
// Build/run as a standalone:  go run generate-session-id.go [dev|prod]
package cardcrypto

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"regexp"
)

// SessionId public keys (1024-bit RSA). NOT the KYC keys.
const DevSessionIDPublicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCAP192809jZyaw62g/eTzJ3P9H
+RmT88sXUYjQ0K8Bx+rJ83f22+9isKx+lo5UuV8tvOlKwvdDS/pVbzpG7D7NO45c
0zkLOXwDHZkou8fuj8xhDO5Tq3GzcrabNLRLVz3dkx0znfzGOhnY4lkOMIdKxlQb
LuVM/dGDC9UpulF+UwIDAQAB
-----END PUBLIC KEY-----`

const ProdSessionIDPublicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCeZ9uCoxi2XvOw1VmvVLo88TLk
GE+OO1j3fa8HhYlJZZ7CCIAsaCorrU+ZpD5PUTnmME3DJk+JyY1BB3p8XI+C5uno
QucrbxFbkM1lgR10ewz/LcuhleG0mrXL/bzUZbeJqI6v3c9bXvLPKlsordPanYBG
FZkmBPxc8QEdRgH4awIDAQAB
-----END PUBLIC KEY-----`

var hexRe = regexp.MustCompile(`^[0-9A-Fa-f]+$`)

// GenerateSessionID returns (secretKeyHex, sessionIDBase64).
// Pass secret == "" to generate a fresh random 16-byte (32 hex char) secret.
func GenerateSessionID(pemStr, secret string) (string, string, error) {
	if pemStr == "" {
		return "", "", errors.New("pem is required (a SessionId public key, 1024-bit)")
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

	ciphertext, err := rsa.EncryptOAEP(sha1.New(), rand.Reader, pub, secretKeyBase64, nil)
	if err != nil {
		return "", "", err
	}

	return secretKey, base64.StdEncoding.EncodeToString(ciphertext), nil
}
