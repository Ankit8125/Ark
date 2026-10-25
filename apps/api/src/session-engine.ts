import { setTimeout as delay } from "node:timers/promises";
import type { SessionService } from "./sessions.js";

export async function runSessionEngine(
  service: Pick<SessionService, "expireLeases">,
  signal: AbortSignal,
  onFailure: () => void = () => {},
): Promise<void> {
  while (!signal.aborted) {
    try {
      await service.expireLeases();
    } catch {
      if (!signal.aborted) onFailure();
    }
    if (signal.aborted) return;
    try {
      await delay(1000, undefined, { signal });
    } catch {
      if (signal.aborted) return;
      throw new Error("Session reconciliation timer failed.");
    }
  }
}
