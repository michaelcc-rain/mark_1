"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fundCollateral } from "@/app/actions/fund";
import type { Contract } from "@/lib/rain-types";
import { shortAddress, formatCents } from "@/lib/format";
import { Panel, btn } from "@/components/ui";

const PRESETS = [10000, 50000, 100000]; // $100, $500, $1,000 in cents

export function FundPanel({ contract }: { contract: Contract | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  if (!contract) {
    return (
      <Panel className="p-6">
        <h2 className="text-sm font-semibold text-slate-900">Add funds</h2>
        <p className="mt-2 text-sm text-slate-500">
          Your collateral account is still provisioning. This can take a moment after
          approval.
        </p>
        <button onClick={() => router.refresh()} className={`${btn("secondary")} mt-4`}>
          Check again
        </button>
      </Panel>
    );
  }

  function fund(amountCents: number) {
    setMsg(null);
    start(async () => {
      const r = await fundCollateral(amountCents);
      if (r.ok) {
        setMsg({ tone: "ok", text: `Deposited ${formatCents(amountCents)}` });
        router.refresh();
      } else {
        setMsg({ tone: "err", text: r.error });
      }
    });
  }

  return (
    <Panel className="p-6">
      <h2 className="text-sm font-semibold text-slate-900">Add funds</h2>
      <div className="mt-3 space-y-1.5 rounded-xl bg-slate-50 p-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Deposit address</span>
          <span className="font-mono-num text-slate-800">
            {shortAddress(contract.depositAddress)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Chain ID</span>
          <span className="font-mono-num text-slate-800">{contract.chainId}</span>
        </div>
      </div>
      <p className="mt-4 text-xs text-slate-500">
        Send USDC on-chain to that address — or simulate a deposit in sandbox:
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {PRESETS.map((amount) => (
          <button
            key={amount}
            disabled={pending}
            onClick={() => fund(amount)}
            className={btn("secondary")}
          >
            {pending ? "…" : `+ ${formatCents(amount)}`}
          </button>
        ))}
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
