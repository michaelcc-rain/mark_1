import { Panel } from "@/components/ui";
import { formatCents } from "@/lib/format";
import type { Balances } from "@/lib/rain-types";

export function BalanceCard({ balances }: { balances: Balances | null }) {
  return (
    <Panel className="p-6">
      <p className="text-sm font-medium text-slate-500">Spending power</p>
      <p className="mt-1 font-mono-num text-4xl font-bold tracking-tight text-slate-900">
        {formatCents(balances?.spendingPower)}
      </p>
      <div className="mt-6 grid grid-cols-3 gap-4 border-t border-slate-100 pt-4">
        <Stat label="Credit limit" value={formatCents(balances?.creditLimit)} />
        <Stat label="Pending" value={formatCents(balances?.pendingCharges)} />
        <Stat label="Balance due" value={formatCents(balances?.balanceDue)} />
      </div>
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-0.5 font-mono-num text-sm font-semibold text-slate-700">{value}</p>
    </div>
  );
}
