import { Onboarding } from "@/components/Onboarding";
import { getUserId } from "@/lib/session";
import { getKycStatus } from "@/app/actions/kyc";
import { isRainConfigured } from "@/lib/rain";
import type { ApplicationStatus } from "@/lib/rain-types";

export default async function OnboardingPage() {
  const userId = await getUserId();

  let initialStatus: ApplicationStatus | null = null;
  if (userId && isRainConfigured()) {
    const r = await getKycStatus();
    if (r.ok) initialStatus = r.status;
  }

  return <Onboarding hasSession={Boolean(userId)} initialStatus={initialStatus} />;
}
