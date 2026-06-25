"use client";

import { useEffect, useRef, useState } from "react";
import type { Card } from "@/lib/rain-types";
import { formatPan } from "@/lib/format";
import {
  generateSessionIdWebCrypto,
  decryptSecretWebCrypto,
  DEV_SESSIONID_PUBLIC_KEY,
} from "@/lib/card-crypto.client";
import { btn } from "@/components/ui";

const AUTO_HIDE_MS = 25_000;

export function CardView({ card }: { card: Card }) {
  const [revealed, setRevealed] = useState<{ pan: string; cvc: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function reveal() {
    setError(null);
    setLoading(true);
    try {
      // Browser generates the AES secret; it never leaves the client.
      const { sessionId, secretKey } =
        await generateSessionIdWebCrypto(DEV_SESSIONID_PUBLIC_KEY);
      const res = await fetch("/api/card/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Failed (${res.status})`);
      }
      const { encryptedPan, encryptedCvc } = (await res.json()) as {
        encryptedPan: { iv: string; data: string };
        encryptedCvc: { iv: string; data: string };
      };
      const pan = await decryptSecretWebCrypto(
        encryptedPan.data,
        encryptedPan.iv,
        secretKey,
      );
      const cvc = await decryptSecretWebCrypto(
        encryptedCvc.data,
        encryptedCvc.iv,
        secretKey,
      );
      setRevealed({ pan, cvc });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setRevealed(null), AUTO_HIDE_MS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reveal card");
    } finally {
      setLoading(false);
    }
  }

  function hide() {
    setRevealed(null);
    if (timer.current) clearTimeout(timer.current);
  }

  const frozen = card.status === "locked";
  const exp = `${card.expirationMonth}/${String(card.expirationYear).slice(-2)}`;

  return (
    <div className="max-w-sm">
      <div className="relative aspect-[1.586/1] w-full overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-500 p-6 text-white shadow-lg">
        <div className="flex items-start justify-between">
          <span className="text-sm font-semibold tracking-wide">Aurora</span>
          <span className="text-[10px] font-medium uppercase tracking-widest text-white/70">
            Virtual
          </span>
        </div>
        <div className="mt-5 h-7 w-10 rounded-md bg-white/30" />
        <div className="mt-4 font-mono-num text-lg tracking-[0.18em]">
          {revealed ? formatPan(revealed.pan) : `•••• •••• •••• ${card.last4}`}
        </div>
        <div className="mt-5 flex items-end justify-between text-xs">
          <div>
            <div className="text-[9px] uppercase tracking-widest text-white/60">
              Card holder
            </div>
            <div className="font-medium">RAIN MEMBER</div>
          </div>
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-widest text-white/60">Exp</div>
            <div className="font-mono-num font-medium">{exp}</div>
          </div>
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-widest text-white/60">CVC</div>
            <div className="font-mono-num font-medium">{revealed ? revealed.cvc : "•••"}</div>
          </div>
        </div>

        {frozen && (
          <div className="absolute inset-0 grid place-items-center bg-slate-900/40 backdrop-blur-[1px]">
            <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700">
              Frozen
            </span>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        {revealed ? (
          <button onClick={hide} className={btn("secondary")}>
            Hide details
          </button>
        ) : (
          <button onClick={reveal} disabled={loading} className={btn("secondary")}>
            {loading ? "Decrypting…" : "Reveal card details"}
          </button>
        )}
        {revealed && (
          <span className="text-xs text-slate-400">Auto-hides in a few seconds</span>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
