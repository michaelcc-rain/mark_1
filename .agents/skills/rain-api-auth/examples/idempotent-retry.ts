#!/usr/bin/env -S npx tsx
/**
 * idempotent-retry.ts — Safe-retry pattern for a Rain write using Idempotency-Key.
 *
 * Demonstrates the rule from the SKILL:
 *   - One idempotency key per logical operation (a UUID, <= 64 chars).
 *   - The SAME key is reused across retries, so a network blip never
 *     double-creates the resource.
 *   - 5xx responses are NOT cached by Rain -> safe to retry, the request runs
 *     again. 4xx responses ARE cached -> retrying returns the same error, so
 *     we stop retrying on 4xx.
 *
 * The Rain SDK already retries connection errors / 408 / 409 / 429 / 5xx up to
 * `maxRetries` times. This example adds an OUTER retry for illustration and to
 * show the idempotency-key contract explicitly.
 *
 * Usage:
 *   RAIN_API_KEY=<sandbox-key> RAIN_ENV=dev USER_ID=<userId> npx tsx idempotent-retry.ts
 *
 * Requires: npm install @rainapi/rain-sdk
 */
import { randomUUID } from 'node:crypto';
import Rain from '@rainapi/rain-sdk';

async function createCardWithRetry(
  client: Rain,
  userId: string,
  maxAttempts = 3,
): Promise<unknown> {
  // ONE key for this logical create. Reused on every retry below.
  const idempotencyKey = randomUUID(); // <= 64 chars; a UUID is ideal

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await client.users.createCard(
        userId,
        { type: 'virtual' },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      );
    } catch (err) {
      lastErr = err;

      // 4xx (except 429) is cached by Rain — retrying returns the same error.
      // Stop immediately; the request will not be reprocessed.
      if (
        err instanceof Rain.BadRequestError ||
        err instanceof Rain.PermissionDeniedError ||
        err instanceof Rain.NotFoundError ||
        err instanceof Rain.UnprocessableEntityError ||
        err instanceof Rain.AuthenticationError
      ) {
        throw err;
      }

      // 5xx / 429 / connection errors are safe to retry with the SAME key.
      if (attempt < maxAttempts) {
        const backoffMs = 250 * 2 ** (attempt - 1); // 250ms, 500ms, ...
        console.warn(`attempt ${attempt} failed, retrying in ${backoffMs}ms with same idempotency key`);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
    }
  }
  throw lastErr;
}

async function main(): Promise<void> {
  const apiKey = process.env['RAIN_API_KEY'];
  const userId = process.env['USER_ID'];
  if (!apiKey || !userId) {
    console.error('Set RAIN_API_KEY and USER_ID. (USER_ID = an existing Rain user id.)');
    process.exit(1);
  }
  const environment = (process.env['RAIN_ENV'] ?? 'dev') as 'dev' | 'production';
  const client = new Rain({ apiKey, environment });

  const card = await createCardWithRetry(client, userId);
  console.log('created (or returned cached):', card);
}

main();
