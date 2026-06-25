import { redirect } from "next/navigation";
import { getSnapshot, getSpendTransactions } from "@/lib/data";
import { isApproved } from "@/lib/kyc-status";
import { SimulatePurchase } from "@/components/SimulatePurchase";
import { TxList } from "@/components/TxList";
import { ConnectPrompt } from "@/components/ConnectPrompt";

export default async function TransactionsPage() {
  const snap = await getSnapshot();
  if (!snap.configured) return <ConnectPrompt />;
  if (!snap.userId) redirect("/onboarding");
  if (!isApproved(snap.application?.applicationStatus)) redirect("/onboarding");

  const txs = await getSpendTransactions();

  const spendingPower = snap.balances?.spendingPower ?? 0;
  const cardActive = snap.card?.status === "active";
  const enabled = cardActive && spendingPower > 0;
  const disabledReason = !snap.card
    ? "Issue a card first."
    : !cardActive
      ? "Your card is frozen — unfreeze it to spend."
      : spendingPower <= 0
        ? "Add funds first to unlock spending power."
        : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Transactions</h1>
        <p className="mt-1 text-sm text-slate-500">Card activity, newest first.</p>
      </div>

      <SimulatePurchase enabled={enabled} disabledReason={disabledReason} />
      <TxList txs={txs} />
    </div>
  );
}
