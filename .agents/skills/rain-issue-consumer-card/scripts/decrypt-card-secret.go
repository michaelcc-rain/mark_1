// Package cardcrypto: corrected AES-128-GCM decrypt for Rain card secrets.
//
// The wire format is `ciphertext || 16-byte GCM tag`. Go's cipher.AEAD.Open expects the
// ciphertext with the tag appended and verifies the tag automatically — so passing the
// full base64-decoded `data` is correct (it returns an error on tag mismatch). This avoids
// the bug in Rain's official Node snippet (which decrypted over the tag and skipped
// verification).
//
// Inputs come from GET /issuing/cards/{cardId}/secrets (or the scoped-card response).
// secretKeyHex is the 32-char hex string returned by GenerateSessionID.
//
// NOTE arg order: (base64Data, base64Iv, secretKeyHex) — data first, then iv.
// SECURITY: never log the return value.
package cardcrypto

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/hex"
	"errors"
)

// DecryptSecret returns the plaintext PAN/CVC as a string.
func DecryptSecret(base64Data, base64Iv, secretKeyHex string) (string, error) {
	if base64Data == "" {
		return "", errors.New("base64Data is required")
	}
	if base64Iv == "" {
		return "", errors.New("base64Iv is required")
	}
	if secretKeyHex == "" || !hexRe.MatchString(secretKeyHex) {
		return "", errors.New("secretKey must be a hex string")
	}

	key, err := hex.DecodeString(secretKeyHex) // 16 bytes -> AES-128
	if err != nil {
		return "", err
	}
	iv, err := base64.StdEncoding.DecodeString(base64Iv)
	if err != nil {
		return "", err
	}
	ctWithTag, err := base64.StdEncoding.DecodeString(base64Data) // ciphertext || tag
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	// 12-byte nonce is the standard GCM size; NonceSize matches the IV Rain delivers.
	aead, err := cipher.NewGCMWithNonceSize(block, len(iv))
	if err != nil {
		return "", err
	}

	// Open verifies the trailing 16-byte tag and returns the plaintext, or an error.
	plaintext, err := aead.Open(nil, iv, ctWithTag, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}
