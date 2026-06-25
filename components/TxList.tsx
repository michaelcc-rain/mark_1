import { Panel, Badge } from "@/components/ui";
import { formatCents, formatDateTime } from "@/lib/format";
import type { SpendTransaction } from "@/lib/rain-types";

type SpendStatus = SpendTransaction["spend"]["status"];

function tone(status: SpendStatus): "success" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "completed":
      return "success";
    case "pending":
      return "warning";
    case "declined":
      return "danger";
    case "reversed":
      return "neutral";
    default:
      return "neutral";
  }
}

export function TxList({ txs }: { txs: SpendTransaction[] }) {
  if (txs.length === 0) {
    return (
      <Panel className="p-10 text-center">
        <p className="text-sm text-slate-500">No transactions yet.</p>
        <p className="mt-1 text-xs text-slate-400">
          Simulate a purchase above to see it appear here.
        </p>
      </Panel>
    );
  }

  return (
    <Panel className="divide-y divide-slate-100">
      {txs.map((tx) => {
        const s = tx.spend;
        return (
          <div key={tx.id} className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">
                {s.merchantName}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {s.merchantCategory || s.merchantCategoryCode} · {formatDateTime(s.authorizedAt)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge tone={tone(s.status)}>{s.status}</Badge>
              <span
                className={`font-mono-num text-sm font-semibold ${
                  s.status === "declined" ? "text-slate-400 line-through" : "text-slate-900"
                }`}
              >
                {formatCents(s.amount)}
              </span>
            </div>
          </div>
        );
      })}
    </Panel>
  );
}
