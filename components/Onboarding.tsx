"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitKyc, getKycStatus, resetSession, type KycInput } from "@/app/actions/kyc";
import type { ApplicationStatus } from "@/lib/rain-types";
import {
  statusLabel,
  isApproved,
  isTerminalReject,
  needsUserAction,
} from "@/lib/kyc-status";
import { Panel, Badge, btn } from "@/components/ui";

type Phase = "form" | "pending" | "approved" | "rejected" | "action";

function phaseFor(status: ApplicationStatus | null): Phase {
  if (!status) return "form";
  if (isApproved(status)) return "approved";
  if (isTerminalReject(status)) return "rejected";
  if (needsUserAction(status)) return "action";
  return "pending";
}

const FIELDS = [
  { name: "firstName", label: "First name", defaultValue: "Jane", type: "text" },
  { name: "lastName", label: "Last name", defaultValue: "Approved", type: "text" },
  { name: "email", label: "Email", defaultValue: "jane@example.com", type: "email" },
  { name: "phoneCountryCode", label: "Phone country code", defaultValue: "1", type: "text" },
  { name: "phoneNumber", label: "Phone number", defaultValue: "5125550100", type: "tel" },
  { name: "birthDate", label: "Date of birth", defaultValue: "1990-01-15", type: "date" },
  { name: "nationalId", label: "SSN / National ID", defaultValue: "123456789", type: "text" },
  { name: "line1", label: "Address", defaultValue: "123 Main St", type: "text" },
  { name: "city", label: "City", defaultValue: "Austin", type: "text" },
  { name: "region", label: "State", defaultValue: "TX", type: "text" },
  { name: "postalCode", label: "ZIP", defaultValue: "78701", type: "text" },
  { name: "countryCode", label: "Country", defaultValue: "US", type: "text" },
] as const;

export function Onboarding({
  hasSession,
  initialStatus,
}: {
  hasSession: boolean;
  initialStatus: ApplicationStatus | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(
    initialStatus ? phaseFor(initialStatus) : hasSession ? "pending" : "form",
  );
  const [status, setStatus] = useState<ApplicationStatus | null>(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const attempts = useRef(0);

  // Once approved, head to the dashboard.
  useEffect(() => {
    if (phase === "approved") {
      const t = setTimeout(() => router.push("/dashboard"), 1100);
      return () => clearTimeout(t);
    }
  }, [phase, router]);

  // Poll for the KYC verdict while pending.
  useEffect(() => {
    if (phase !== "pending") return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      attempts.current += 1;
      const r = await getKycStatus();
      if (cancelled) return;
      if (r.ok) {
        setStatus(r.status);
        const next = phaseFor(r.status);
        if (next !== "pending") setPhase(next);
      }
      if (attempts.current > 40) setError("Still processing — check back shortly.");
    };
    void tick();
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const input = Object.fromEntries(fd.entries()) as unknown as KycInput;
    startSubmit(async () => {
      const r = await submitKyc(input);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setStatus(r.status);
      setPhase(phaseFor(r.status));
    });
  }

  if (phase !== "form") {
    return (
      <div className="mx-auto max-w-md">
        <Panel className="p-8 text-center">
          <StatusGraphic phase={phase} />
          <h1 className="mt-5 text-xl font-semibold text-slate-900">
            {phase === "approved"
              ? "You're approved"
              : phase === "rejected"
                ? "Application declined"
                : phase === "action"
                  ? "More info needed"
                  : "Reviewing your application"}
          </h1>
          <div className="mt-3 flex justify-center">
            <Badge
              tone={
                phase === "approved"
                  ? "success"
                  : phase === "rejected"
                    ? "danger"
                    : phase === "action"
                      ? "warning"
                      : "accent"
              }
            >
              {statusLabel(status)}
            </Badge>
          </div>
          <p className="mt-4 text-sm text-slate-500">
            {phase === "approved"
              ? "Taking you to your dashboard…"
              : phase === "rejected"
                ? "This sandbox application can't proceed. Start over to try again."
                : phase === "action"
                  ? "In production this would link out to identity verification. For the sandbox demo, start over with a last name containing “approved”."
                  : "Rain is running compliance checks. This usually resolves in a few seconds in sandbox."}
          </p>
          {error && <p className="mt-3 text-sm text-amber-600">{error}</p>}
          {phase !== "approved" && (
            <form action={resetSession} className="mt-6">
              <button type="submit" className={btn("secondary")}>
                Start over
              </button>
            </form>
          )}
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Open your account
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          A few details to run KYC. This is a sandbox — keep the last name as
          “Approved” for instant approval.
        </p>
      </div>
      <Panel className="p-6">
        <form onSubmit={onSubmit} className="grid grid-cols-2 gap-4">
          {FIELDS.map((f) => (
            <label
              key={f.name}
              className={f.name === "line1" ? "col-span-2 block" : "block"}
            >
              <span className="mb-1.5 block text-xs font-medium text-slate-600">
                {f.label}
              </span>
              <input
                name={f.name}
                type={f.type}
                defaultValue={f.defaultValue}
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </label>
          ))}
          <div className="col-span-2 mt-2">
            <button type="submit" disabled={submitting} className={`${btn("primary")} w-full`}>
              {submitting ? "Submitting…" : "Create account"}
            </button>
          </div>
          {error && (
            <p className="col-span-2 text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
        </form>
      </Panel>
    </div>
  );
}

function StatusGraphic({ phase }: { phase: Phase }) {
  const tone =
    phase === "approved"
      ? "bg-emerald-100 text-emerald-600"
      : phase === "rejected"
        ? "bg-red-100 text-red-600"
        : phase === "action"
          ? "bg-amber-100 text-amber-600"
          : "bg-indigo-100 text-indigo-600";
  return (
    <div
      className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${tone}`}
    >
      {phase === "approved" ? (
        <span className="text-2xl">✓</span>
      ) : phase === "rejected" ? (
        <span className="text-2xl">×</span>
      ) : (
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
    </div>
  );
}
