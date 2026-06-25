// verify-auth.go — Smoke-test Rain API auth with the Go SDK.
//
// Initializes the Rain client from RAIN_API_KEY and calls Companies.List().
// Prints a success/failure line. No data is mutated.
//
// Usage:
//   RAIN_API_KEY=<sandbox-key> RAIN_ENV=dev go run verify-auth.go
//
// Env:
//   RAIN_API_KEY  (required) your sandbox API key value
//   RAIN_ENV      "dev" (default) | "production"
//
// Requires: go get -u github.com/SignifyHQ/rain-sdk-go@v0.1.0
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	rainsdk "github.com/SignifyHQ/rain-sdk-go"
	"github.com/SignifyHQ/rain-sdk-go/option"
)

func main() {
	apiKey := os.Getenv("RAIN_API_KEY")
	if apiKey == "" {
		fmt.Println("FAIL: RAIN_API_KEY is not set. Export your sandbox key first.")
		os.Exit(1)
	}

	env := os.Getenv("RAIN_ENV")
	if env == "" {
		env = "dev"
	}
	envOpt := option.WithEnvironmentDev()
	if env == "production" {
		envOpt = option.WithEnvironmentProduction()
	}

	client := rainsdk.NewClient(
		option.WithAPIKey(apiKey),
		envOpt,
	)

	// The Go SDK has NO default request timeout — always pass a deadline.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	companies, err := client.Companies.List(ctx, rainsdk.CompanyListParams{})
	if err != nil {
		var apierr *rainsdk.Error
		if errors.As(err, &apierr) {
			switch apierr.StatusCode {
			case 401:
				fmt.Println("FAIL (401): bad key or wrong environment. " +
					"A sandbox key only works against \"dev\"; a prod key only against \"production\".")
			case 403:
				fmt.Println("FAIL (403): the key authenticated but lacks permission for Companies.List().")
			default:
				fmt.Printf("FAIL (%d): %s\n", apierr.StatusCode, apierr.Error())
			}
		} else {
			fmt.Printf("FAIL: %s\n", err.Error())
		}
		os.Exit(1)
	}

	fmt.Printf("OK: authenticated to %q. Companies.List() returned %d item(s).\n", env, len(*companies))
}
