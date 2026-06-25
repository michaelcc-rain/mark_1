"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { simulatePurchase } from "@/app/actions/transactions";
import { Panel, btn } from "@/components/ui";

export function SimulatePurchase({
  enabled,
  disabledReason,
}: {
  enabled: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [amount, setAmount] = useState("42.99");
  const [merchant, setMerchant] = useState("Blue Bottle Coffee");

  function run(decline: boolean) {
    setMsg(null);
    const amountCents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setMsg({ tone: "err", text: "Enter a valid amount" });
      return;
    }
    start(async () => {
      const r = await simulatePurchase({
        amountCents,
        merchantName: merchant,
        merchantCategoryCode: "5814",
        decline,
      });
      if (r.ok) {
        setMsg({
          tone: r.status === "declined" ? "err" : "ok",
          text:
            r.status === "declined"
              ? `Declined${r.declinedReason ? `: ${r.declinedReason}` : ""}`
              : `Purchase ${r.status}`,
        });
        router.refresh();
      } else {
        setMsg({ tone: "err", text: r.error });
      }
    });
  }

  return (
    <Panel className="p-6">
      <h2 className="text-sm font-semibold text-slate-900">Simulate a purchase</h2>
      {!enabled && disabledReason && (
        <p className="mt-2 text-sm text-amber-600">{disabledReason}</p>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Amount (USD)</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            disabled={!enabled}
            className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
          />
        </label>
        <label className="block flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Merchant</span>
          <input
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            disabled={!enabled}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
          />
        </label>
        <button
          onClick={() => run(false)}
          disabled={!enabled || pending}
          className={btn("primary")}
        >
          {pending ? "…" : "Charge"}
        </button>
        <button
          onClick={() => run(true)}
          disabled={!enabled || pending}
          className={btn("secondary")}
          title="Simulate a declined authorization"
        >
          Decline
        </button>
      </div>
      {msg && (
        <p
          className={`mt-3 text-sm ${msg.tone === "ok" ? "text-emerald-600" : "text-red-600"}`}
        >
          {msg.text}
        </p>
      )}
    </Panel>
  );
}
