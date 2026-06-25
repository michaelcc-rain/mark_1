#!/usr/bin/env -S npx tsx
/**
 * verify-auth.ts — Smoke-test Rain API auth with the TypeScript SDK.
 *
 * Initializes the Rain client from RAIN_API_KEY and calls companies.list().
 * Prints a success/failure line. No data is mutated.
 *
 * Usage:
 *   RAIN_API_KEY=<sandbox-key> RAIN_ENV=dev npx tsx verify-auth.ts
 *
 * Env:
 *   RAIN_API_KEY  (required) your sandbox API key value
 *   RAIN_ENV      'dev' (default) | 'production'
 *
 * Requires: npm install @rainapi/rain-sdk
 */
import Rain from '@rainapi/rain-sdk';

async function main(): Promise<void> {
  const apiKey = process.env['RAIN_API_KEY'];
  if (!apiKey) {
    console.error('FAIL: RAIN_API_KEY is not set. Export your sandbox key first.');
    process.exit(1);
  }

  const environment = (process.env['RAIN_ENV'] ?? 'dev') as 'dev' | 'production';
  const client = new Rain({ apiKey, environment });

  try {
    const companies = await client.companies.list();
    const count = Array.isArray(companies) ? companies.length : 'unknown';
    console.log(`OK: authenticated to '${environment}'. companies.list() returned ${count} item(s).`);
  } catch (err) {
    if (err instanceof Rain.AuthenticationError) {
      console.error('FAIL (401): bad key or wrong environment. ' +
        'A sandbox key only works against environment "dev"; a prod key only against "production".');
    } else if (err instanceof Rain.PermissionDeniedError) {
      console.error('FAIL (403): the key authenticated but lacks permission for companies.list().');
    } else {
      console.error('FAIL:', err instanceof Error ? err.message : String(err));
    }
    process.exit(1);
  }
}

main();
