import { redirect } from "next/navigation";
import { getSnapshot } from "@/lib/data";
import { isApproved } from "@/lib/kyc-status";
import { CardView } from "@/components/CardView";
import { FreezeToggle } from "@/components/FreezeToggle";
import { IssueCardPanel } from "@/components/IssueCardPanel";
import { ConnectPrompt } from "@/components/ConnectPrompt";
import { formatCents } from "@/lib/format";

export default async function CardPage() {
  const snap = await getSnapshot();
  if (!snap.configured) return <ConnectPrompt />;
  if (!snap.userId) redirect("/onboarding");
  if (!isApproved(snap.application?.applicationStatus)) redirect("/onboarding");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Card</h1>
        <p className="mt-1 text-sm text-slate-500">
          Your virtual card. Reveal details to copy the number, or freeze it instantly.
        </p>
      </div>

      {snap.card ? (
        <div className="space-y-5">
          <CardView card={snap.card} />
          <div className="flex flex-wrap items-center gap-4">
            <FreezeToggle status={snap.card.status} />
            {snap.card.limit && (
              <span className="text-sm text-slate-500">
                Limit {formatCents(snap.card.limit.amount)} · {snap.card.limit.frequency}
              </span>
            )}
          </div>
        </div>
      ) : (
        <IssueCardPanel />
      )}
    </div>
  );
}
