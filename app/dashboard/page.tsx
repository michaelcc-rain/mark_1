import Link from "next/link";
import { redirect } from "next/navigation";
import { getSnapshot, nextStep, type NextStep } from "@/lib/data";
import { isApproved } from "@/lib/kyc-status";
import { BalanceCard } from "@/components/BalanceCard";
import { FundPanel } from "@/components/FundPanel";
import { Panel, btn } from "@/components/ui";

export default async function DashboardPage() {
  const snap = await getSnapshot();

  if (!snap.configured) {
    return (
      <Panel className="p-8 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Connect Rain to continue</h1>
        <p className="mt-2 text-sm text-slate-500">
          Set <code className="font-mono-num">RAIN_API_KEY</code> in{" "}
          <code className="font-mono-num">.env.local</code> and restart the dev server.
        </p>
      </Panel>
    );
  }
  if (!snap.userId) redirect("/onboarding");
  if (!isApproved(snap.application?.applicationStatus)) redirect("/onboarding");

  const step = nextStep(snap);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">Your stablecoin-backed account</p>
      </div>

      <NextStepBanner step={step} />

      <div className="grid gap-6 sm:grid-cols-2">
        <BalanceCard balances={snap.balances} />
        <FundPanel contract={snap.contract} />
      </div>
    </div>
  );
}

function NextStepBanner({ step }: { step: NextStep }) {
  if (step === "ready") {
    return (
      <Banner
        text="You're all set. Make a purchase to see it land in your activity."
        href="/transactions"
        cta="Make a purchase"
      />
    );
  }
  if (step === "issue-card") {
    return (
      <Banner
        text="Next: issue your virtual card to start spending."
        href="/card"
        cta="Issue card"
      />
    );
  }
  if (step === "fund") {
    return (
      <Banner text="Next: add funds below to unlock spending power." />
    );
  }
  return null;
}

function Banner({ text, href, cta }: { text: string; href?: string; cta?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-indigo-100 bg-indigo-50 px-5 py-4">
      <p className="text-sm font-medium text-indigo-900">{text}</p>
      {href && cta && (
        <Link href={href} className={btn("primary")}>
          {cta}
        </Link>
      )}
    </div>
  );
}
