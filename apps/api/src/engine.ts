import { createPool } from "@ark/db";
import { IdentityService } from "./identity.js";
import { SessionService } from "./sessions.js";
import { runSessionEngine } from "./session-engine.js";
import { RepositoryExecutionService } from "./repository-executions.js";

const connection = process.env.DATABASE_URL;
if (!connection)
  throw new Error(
    "DATABASE_URL is missing. Run setup:env and db:prepare first.",
  );
const pool = createPool(connection);
const controller = new AbortController();
pool.on("error", () => {
  console.error("An idle reconciliation database connection failed.");
});
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());
try {
  const identity = new IdentityService(pool, 43200);
  if (!(await identity.isReady())) throw new Error("Migrations are not ready.");
  console.log("Stub and repository preparation lease reconciliation ready.");
  const sessions = new SessionService(pool, identity);
  const repositories = new RepositoryExecutionService(pool, identity);
  await runSessionEngine(
    {
      expireLeases: async () => {
        const results = await Promise.allSettled([
          sessions.expireLeases(),
          repositories.expireLeases(),
        ]);
        if (results.some((result) => result.status === "rejected"))
          throw new Error("A work lease reconciliation pass failed.");
        return results.reduce(
          (count, result) =>
            count + (result.status === "fulfilled" ? result.value : 0),
          0,
        );
      },
    },
    controller.signal,
    () => {
      console.error("Session reconciliation is unavailable; retrying.");
    },
  );
} catch {
  console.error(
    "Session reconciliation startup failed. Check the local database and migrations.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
