"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCardStatus } from "@/app/actions/cards";
import type { CardStatus } from "@/lib/rain-types";
import { btn } from "@/components/ui";

export function FreezeToggle({ status }: { status: CardStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (status !== "active" && status !== "locked") {
    return <span className="text-sm text-slate-500">Card status: {status}</span>;
  }

  const next: "active" | "locked" = status === "active" ? "locked" : "active";

  function toggle() {
    setError(null);
    start(async () => {
      const r = await setCardStatus(next);
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggle}
        disabled={pending}
        className={btn(status === "active" ? "secondary" : "primary")}
      >
        {pending ? "…" : status === "active" ? "Freeze card" : "Unfreeze card"}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
