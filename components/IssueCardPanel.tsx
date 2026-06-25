"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { issueCard } from "@/app/actions/cards";
import { Panel, btn } from "@/components/ui";

export function IssueCardPanel() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function issue() {
    setError(null);
    start(async () => {
      const r = await issueCard();
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  return (
    <Panel className="p-8 text-center">
      <h2 className="text-lg font-semibold text-slate-900">Issue your virtual card</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
        A virtual card with a $500 rolling-30-day limit, ready to spend instantly.
      </p>
      <button onClick={issue} disabled={pending} className={`${btn("primary")} mt-5`}>
        {pending ? "Issuing…" : "Issue virtual card"}
      </button>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
