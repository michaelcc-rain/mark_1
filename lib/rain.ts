import "server-only";
import Rain from "rain-sdk";

/**
 * Server-only Rain SDK accessor. The API key is a secret and must never reach
 * the browser — every call to `rain()` happens inside a Server Action, Route
 * Handler, or Server Component.
 *
 * The SDK constructor throws if no apiKey is present; we gate on
 * `isRainConfigured()` first so a missing key surfaces as a friendly setup
 * banner instead of an uncaught 500.
 */
let _client: Rain | null = null;

/**
 * Which Rain issuing API the server talks to. Defaults to the sandbox because everything in
 * this demo (the "Approved" auto-approve shortcut, /simulate/*, the embedded wallet's backend)
 * is sandbox-only. The API key must match: a production key is "Invalid api key" on dev and
 * vice versa.
 */
export type RainEnvironment = "dev" | "production";

export function rainEnvironment(): RainEnvironment {
  return process.env.RAIN_ENVIRONMENT === "production" ? "production" : "dev";
}

export function isRainConfigured(): boolean {
  return Boolean(process.env.RAIN_API_KEY);
}

export function rain(): Rain {
  if (!isRainConfigured()) {
    throw new Error("RAIN_API_KEY is not set");
  }
  if (!_client) {
    _client = new Rain({
      apiKey: process.env.RAIN_API_KEY,
      environment: rainEnvironment(), // dev = https://api-dev.raincards.xyz/v1/issuing
    });
  }
  return _client;
}
