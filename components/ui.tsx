import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200 bg-white shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

type Tone = "neutral" | "success" | "danger" | "warning" | "accent";

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  const tones: Record<Tone, string> = {
    neutral: "bg-slate-100 text-slate-600",
    success: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
    danger: "bg-red-50 text-red-700 ring-1 ring-red-100",
    warning: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
    accent: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";

const buttonVariants = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700",
  secondary: "bg-white text-slate-800 border border-slate-200 hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100",
  danger: "bg-red-600 text-white hover:bg-red-700",
} as const;

export function btn(variant: keyof typeof buttonVariants = "primary"): string {
  return cn(buttonBase, buttonVariants[variant]);
}
