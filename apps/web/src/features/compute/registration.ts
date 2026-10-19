import type { Runner } from "@ark/contracts";

export function registrationStatus(runner: Runner, observedAt: string) {
  if (runner.revokedAt) return "Revoked";
  if (runner.enrolledAt) return "Enrolled";
  return Date.parse(runner.enrollmentExpiresAt) <= Date.parse(observedAt)
    ? "Expired"
    : "Pending";
}
