import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { SetupBanner } from "@/components/SetupBanner";
import { isRainConfigured } from "@/lib/rain";
import { getUserId } from "@/lib/session";

export const metadata: Metadata = {
  title: "Aurora — stablecoin neobank",
  description: "A demo neobank on Rain's stablecoin card platform.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const configured = isRainConfigured();
  const hasSession = Boolean(await getUserId());

  return (
    <html lang="en">
      <body>
        <div className="flex min-h-full flex-col">
          <Nav hasSession={hasSession} />
          {!configured && <SetupBanner />}
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:py-10">
            {children}
          </main>
          <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400">
            Sandbox demo · not a real bank · built on the Rain API
          </footer>
        </div>
      </body>
    </html>
  );
}
