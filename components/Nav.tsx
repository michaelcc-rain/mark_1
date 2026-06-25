"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { resetSession } from "@/app/actions/kyc";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/card", label: "Card" },
  { href: "/transactions", label: "Transactions" },
];

export function Nav({ hasSession }: { hasSession: boolean }) {
  const pathname = usePathname();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3.5">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-lg font-bold tracking-tight text-slate-900">Aurora</span>
          <span className="text-xs font-medium text-slate-400">powered by Rain</span>
        </Link>

        {hasSession && (
          <nav className="flex items-center gap-1">
            {LINKS.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                    active
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-500 hover:text-slate-900",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
            <form action={resetSession} className="ml-2">
              <button
                type="submit"
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-400 transition hover:text-red-600"
              >
                Start over
              </button>
            </form>
          </nav>
        )}
      </div>
    </header>
  );
}
