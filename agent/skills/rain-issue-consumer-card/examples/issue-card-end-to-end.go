// Issue a Rain consumer card end-to-end (Go).
//
//	1. create application  2. await KYC  3. create virtual card
//	4. retrieve + decrypt secrets
//
// Run (sandbox):
//
//	export RAIN_API_KEY=<sandbox key>
//	go run issue-card-end-to-end.go
//
// Uses the sandbox `approved`-last-name shortcut. Prints only last4.
//
// The session-id + decrypt helpers live in ../scripts (package cardcrypto). In a real
// project, import that package; here the calls are shown inline as cardcrypto.*.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	rainsdk "github.com/SignifyHQ/rain-sdk-go"
	"github.com/SignifyHQ/rain-sdk-go/option"

	cardcrypto "example.com/rain/scripts" // the ../scripts package
)

var terminalFail = map[string]bool{"denied": true, "locked": true, "canceled": true, "exempt": true}
var actionRequired = map[string]bool{"needsVerification": true, "needsInformation": true}

func awaitApproval(ctx context.Context, client *rainsdk.Client, userID string) error {
	deadline := time.Now().Add(120 * time.Second)
	for time.Now().Before(deadline) {
		app, err := client.Applications.User.Get(ctx, userID)
		if err != nil {
			return err
		}
		switch status := string(app.ApplicationStatus); {
		case status == "approved":
			return nil
		case terminalFail[status]:
			return fmt.Errorf("terminal status: %s", status)
		case actionRequired[status]:
			return fmt.Errorf("action required (%s): redirect to applicationCompletionLink", status)
		}
		time.Sleep(4 * time.Second) // pending | manualReview | notStarted
	}
	return errors.New("timed out waiting for KYC")
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	client := rainsdk.NewClient(
		option.WithAPIKey(os.Getenv("RAIN_API_KEY")),
		option.WithEnvironmentDev(), // option.WithEnvironmentProduction() for live
	)

	// 1. create application (sandbox: last name contains "approved")
	app, err := client.Applications.User.New(ctx, rainsdk.ApplicationUserNewParams{
		IPAddress:                rainsdk.String("203.0.113.10"),
		Occupation:               rainsdk.String("15-1252"),
		AnnualSalary:             rainsdk.String("50000-100000"),
		AccountPurpose:           rainsdk.String("web3Payments"),
		ExpectedMonthlyVolume:    rainsdk.String("1000-5000"),
		IsTermsOfServiceAccepted: rainsdk.Bool(true),
		WalletAddress:            rainsdk.String("0x1234567890abcdef1234567890abcdef12345678"),
		FirstName:                rainsdk.String("Jane"),
		LastName:                 rainsdk.String("Doe approved"),
		BirthDate:                rainsdk.String("1990-04-15"),
		NationalID:               rainsdk.String("123456789"),
		CountryOfIssue:           rainsdk.String("US"),
		Email:                    rainsdk.String(fmt.Sprintf("jane.doe.%d@example.com", time.Now().Unix())),
	}, option.WithHeader("Idempotency-Key", randomKey()))
	if err != nil {
		panic(err)
	}
	userID := app.ID
	fmt.Println("application:", userID, "status:", app.ApplicationStatus)

	// 2. await KYC
	if err := awaitApproval(ctx, client, userID); err != nil {
		panic(err)
	}
	fmt.Println("KYC approved")

	// 3. create a virtual card ($500 / rolling 30 days)
	card, err := client.Users.NewCard(ctx, userID, rainsdk.UserNewCardParams{
		Type: rainsdk.UserNewCardParamsTypeVirtual,
		Limit: rainsdk.IssuingCardLimitParam{
			Amount:    rainsdk.Int(50000),
			Frequency: "per30DayPeriod",
		},
	}, option.WithHeader("Idempotency-Key", randomKey()))
	if err != nil {
		panic(err)
	}
	cardID := card.ID
	fmt.Println("card created:", cardID)

	// 4. retrieve + decrypt secrets (SessionId key + AES-128-GCM)
	secretKey, sessionID, err := cardcrypto.GenerateSessionID(cardcrypto.DevSessionIDPublicKey, "")
	if err != nil {
		panic(err)
	}
	secrets, err := client.Cards.GetSecrets(ctx, cardID, option.WithHeader("SessionId", sessionID))
	if err != nil {
		panic(err)
	}
	pan, err := cardcrypto.DecryptSecret(secrets.EncryptedPan.Data, secrets.EncryptedPan.IV, secretKey)
	if err != nil {
		panic(err)
	}
	_, _ = cardcrypto.DecryptSecret(secrets.EncryptedCvc.Data, secrets.EncryptedCvc.IV, secretKey)
	fmt.Println("issued card ending", pan[len(pan)-4:]) // never log the full PAN/CVC
}

func randomKey() string {
	return fmt.Sprintf("%d-%d", time.Now().UnixNano(), os.Getpid())
}
