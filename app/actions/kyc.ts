"use server";

import { randomUUID } from "node:crypto";
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
  walletAddress: string;
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

/** The user's EVM wallet address (0x + 40 hex chars). Rain deploys the collateral contract
 *  with this wallet as owner, so it must be the embedded wallet created in step 1. */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function submitKyc(input: KycInput): Promise<KycResult> {
  try {
    const walletAddress = input.walletAddress.trim();
    if (!EVM_ADDRESS.test(walletAddress)) {
      return {
        ok: false,
        error: "Wallet address must be a valid EVM address (0x followed by 40 hex characters).",
      };
    }

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
        // Rain-Managed: the embedded Rain wallet's EVM address (created client-side in step 1)
        walletAddress,
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
