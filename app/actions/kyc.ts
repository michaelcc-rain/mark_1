"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { rain } from "@/lib/rain";
import { getUserId, setUserId, clearSession } from "@/lib/session";
import { errMsg } from "@/lib/errors";
import type { ApplicationStatus } from "@/lib/rain-types";

export interface KycInput {
  firstName: string;
  lastName: string;
  email: string;
  phoneCountryCode: string;
  phoneNumber: string;
  birthDate: string; // YYYY-MM-DD
  nationalId: string;
  line1: string;
  city: string;
  region: string;
  postalCode: string;
  countryCode: string;
}

type KycResult =
  | { ok: true; status: ApplicationStatus }
  | { ok: false; error: string };

// Minimal code→name map; the sandbox demo defaults to the US.
const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  CA: "Canada",
  GB: "United Kingdom",
};

/** Rain-Managed programs need a wallet address per user; sandbox only needs a well-formed one. */
function randomEvmAddress(): string {
  return "0x" + randomBytes(20).toString("hex");
}

export async function submitKyc(input: KycInput): Promise<KycResult> {
  try {
    const client = rain();
    const application = await client.applications.user.create(
      {
        // Common object (required on every variant)
        ipAddress: "203.0.113.10",
        occupation: "15-1252", // SOC code: Software Developers
        annualSalary: "50000-100000",
        accountPurpose: "web3Payments",
        expectedMonthlyVolume: "1000-5000",
        isTermsOfServiceAccepted: true,
        // Rain-Managed: a wallet address is required
        walletAddress: randomEvmAddress(),
        // Full-PII variant
        firstName: input.firstName,
        lastName: input.lastName,
        birthDate: input.birthDate,
        nationalId: input.nationalId,
        countryOfIssue: input.countryCode,
        email: input.email,
        // Spec format is digits-only (^[0-9]+$); strip anything else defensively.
        phoneCountryCode: input.phoneCountryCode.replace(/\D/g, ""),
        phoneNumber: input.phoneNumber.replace(/\D/g, ""),
        address: {
          line1: input.line1,
          city: input.city,
          region: input.region,
          postalCode: input.postalCode,
          countryCode: input.countryCode,
          country: COUNTRY_NAMES[input.countryCode.toUpperCase()] ?? input.countryCode,
        },
      },
      { headers: { "Idempotency-Key": randomUUID() } },
    );

    await setUserId(application.id);
    return { ok: true, status: application.applicationStatus };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function getKycStatus(): Promise<KycResult> {
  try {
    const userId = await getUserId();
    if (!userId) return { ok: false, error: "No application in progress" };
    const app = await rain().applications.user.retrieve(userId);
    return { ok: true, status: app.applicationStatus };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function resetSession(): Promise<void> {
  await clearSession();
  redirect("/onboarding");
}
