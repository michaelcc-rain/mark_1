"use client";

import { useEffect, useState, useTransition } from "react";
import { useRainWalletAuth } from "@rainxyz/react";
import { rainWallet, openWalletClient, readEvmAddress } from "@/lib/rain-wallet.client";
import { shortAddress } from "@/lib/format";
import { errMsg } from "@/lib/errors";
import { Panel, Badge, btn } from "@/components/ui";

/**
 * Step 1 of onboarding: create (or restore) the user's embedded Rain wallet.
 *
 * Flow: email → login code → `confirmLoginCode` provisions the wallet on first login →
 * read the EVM address → `onReady`. The address is then registered on the KYC application
 * as `walletAddress`, so Rain deploys the collateral contract against this wallet.
 */
export function WalletStep({
  onReady,
}: {
  /** Fires once the wallet address is known. `email` is the login email, for prefilling KYC. */
  onReady: (wallet: { evmAddress: string; email: string }) => void;
}) {
  // Reactive auth state ("loading" | "unauthenticated" | "authenticated") plus the login
  // actions bound to the page's RainProvider.
  const auth = useRainWalletAuth(rainWallet);

  const [email, setEmail] = useState("jane@example.com");
  const [code, setCode] = useState("");
  // TODO(design): the login sub-state (idle → code sent → verifying) — decide: a small
  // explicit sub-phase union here vs. deriving it from booleans like `codeSent` alongside
  // `auth.state` (a wrong code leaves the attempt open per the SDK, so "code sent" must
  // survive a failed verify; which shape makes that invariant obvious?)
  const [codeSent, setCodeSent] = useState(false);

  const [evmAddress, setEvmAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  // The SDK reads the stored session from IndexedDB; auth.state is "loading" until this
  // resolves. Must run in the browser, hence an effect.
  useEffect(() => {
    rainWallet.awaitSessionRestore().catch(() => undefined);
  }, []);

  // Once authenticated (fresh login or restored session), resolve the client and read the
  // EVM address.
  useEffect(() => {
    if (auth.state !== "authenticated" || evmAddress) return;
    let cancelled = false;
    (async () => {
      try {
        const client = await openWalletClient();
        const address = await readEvmAddress(client);
        if (!cancelled) setEvmAddress(address);
      } catch (e) {
        if (!cancelled) setError(errMsg(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.state, evmAddress]);

  // TODO(design): a session restored on page reload lands here with an address and no user
  // action — decide: auto-advance by calling onReady immediately vs. show "Wallet ready" and
  // wait for the Continue click (auto-advance is one less click, but the user never sees
  // which wallet they are about to register; which matters more for a demo walkthrough?)

  function onSendCode() {
    setError(null);
    startBusy(async () => {
      try {
        await auth.sendLoginCode({ email: email.trim() });
        setCodeSent(true);
      } catch (e) {
        setError(errMsg(e));
      }
    });
  }

  function onVerify() {
    setError(null);
    startBusy(async () => {
      try {
        await auth.confirmLoginCode(code.trim());
        setCode("");
      } catch (e) {
        // TODO(design): error handling for a failed verify — decide: branch on the SDK error
        // code (`isRainError(e) && e.code === RainErrorCode.invalidLoginCode`, both exported
        // from "@rainxyz/wallet"; RAIN_203 = wrong/expired code, the attempt stays open so the
        // code input should remain) vs. one generic message for every failure (what should
        // happen on a non-203 error, e.g. this origin not allowed on Rain's auth proxy —
        // retry, or back to the email input?)
        setError(errMsg(e));
      }
    });
  }

  if (auth.state === "loading") {
    return (
      <Panel className="p-6 text-center text-sm text-slate-500">Restoring wallet session…</Panel>
    );
  }

  if (auth.state === "authenticated") {
    return (
      <Panel className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Your Rain wallet</h2>
          <Badge tone={evmAddress ? "success" : "accent"}>
            {evmAddress ? "Wallet ready" : "Opening wallet…"}
          </Badge>
        </div>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">Signed in as</dt>
          <dd className="truncate text-slate-900">{email}</dd>
          <dt className="text-slate-500">EVM address</dt>
          <dd className="font-mono text-slate-900" title={evmAddress ?? undefined}>
            {shortAddress(evmAddress)}
          </dd>
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          This address is registered on your application. Rain deploys your collateral
          contract against it once KYC is approved.
        </p>
        {error && (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          disabled={!evmAddress}
          onClick={() => evmAddress && onReady({ evmAddress, email })}
          className={`${btn("primary")} mt-5 w-full`}
        >
          Continue to your details →
        </button>
      </Panel>
    );
  }

  return (
    <Panel className="p-6">
      <h2 className="text-sm font-semibold text-slate-900">Create your wallet</h2>
      <p className="mt-1 text-xs text-slate-500">
        We’ll email you a one-time code. Your wallet is created the first time you sign in.
      </p>
      <label className="mt-4 block">
        <span className="mb-1.5 block text-xs font-medium text-slate-600">Email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={codeSent}
          required
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
        />
      </label>
      {codeSent && (
        <label className="mt-3 block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">Login code</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </label>
      )}
      <div className="mt-4 flex gap-2">
        {codeSent ? (
          <>
            <button
              type="button"
              disabled={busy || !code}
              onClick={onVerify}
              className={`${btn("primary")} flex-1`}
            >
              {busy ? "Verifying…" : "Verify code"}
            </button>
            <button type="button" disabled={busy} onClick={onSendCode} className={btn("secondary")}>
              Resend
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy || !email}
            onClick={onSendCode}
            className={`${btn("primary")} w-full`}
          >
            {busy ? "Sending…" : "Send code"}
          </button>
        )}
      </div>
      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </Panel>
  );
}
