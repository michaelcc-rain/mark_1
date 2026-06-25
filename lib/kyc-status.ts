import type { ApplicationStatus } from "./rain-types";

// Pure helpers (no server imports) so both server and client components can use
// them. Mirrors Rain's application state machine.

export function statusLabel(status: ApplicationStatus | null | undefined): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "pending":
      return "Under review";
    case "manualReview":
      return "Manual review";
    case "needsInformation":
      return "Needs information";
    case "needsVerification":
      return "Needs verification";
    case "denied":
      return "Denied";
    case "locked":
      return "Locked";
    case "canceled":
      return "Canceled";
    default:
      return "Processing";
  }
}

const TERMINAL = new Set<ApplicationStatus>(["denied", "locked", "canceled"]);
const ACTION_REQUIRED = new Set<ApplicationStatus>([
  "needsInformation",
  "needsVerification",
]);

export function isApproved(status: ApplicationStatus | null | undefined): boolean {
  return status === "approved";
}

export function isTerminalReject(status: ApplicationStatus | null | undefined): boolean {
  return status ? TERMINAL.has(status) : false;
}

export function needsUserAction(status: ApplicationStatus | null | undefined): boolean {
  return status ? ACTION_REQUIRED.has(status) : false;
}

/** Still working — keep polling. */
export function isPending(status: ApplicationStatus | null | undefined): boolean {
  return !isApproved(status) && !isTerminalReject(status) && !needsUserAction(status);
}
