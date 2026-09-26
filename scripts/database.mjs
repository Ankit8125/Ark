import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createPool, migrate } from "@ark/db";

const envPath = new URL("../.env", import.meta.url);
const raw = readFileSync(envPath, "utf8");
const env = parseEnv(raw);
const adminUrl = env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL;
if (!adminUrl) throw new Error("Run setup:env first.");
let admin;
try {
  admin = new URL(adminUrl);
} catch {
  throw new Error("Local database URL is invalid. Check the ignored .env file.");
}
if (
  !["localhost", "127.0.0.1"].includes(admin.hostname) ||
  admin.pathname !== "/ark_dev" ||
  admin.port !== "5434"
) {
  throw new Error(
    "This helper only manages the local ark_dev database at port 5434.",
  );
}
const mode = process.argv[2];
if (!["prepare", "migrate", "test-prepare"].includes(mode))
  throw new Error("Choose prepare, migrate, or test-prepare.");
const pool = createPool(adminUrl);
const updates = {};
function saveEnv() {
  let next = raw;
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    next = pattern.test(next)
      ? next.replace(pattern, () => line)
      : `${next.trimEnd()}\n${line}\n`;
  }
  writeFileSync(envPath, next, { encoding: "utf8", mode: 0o600 });
}
try {
  if (mode === "test-prepare") {
    const exists = await pool.query(
      "SELECT 1 FROM pg_database WHERE datname = 'ark_test'",
    );
    if (!exists.rowCount) await pool.query("CREATE DATABASE ark_test");
    const test = new URL(adminUrl);
    test.pathname = "/ark_test";
    updates.TEST_DATABASE_URL = test.toString();
    saveEnv();
    console.log(
      "Dedicated ark_test database ready. Its credentials remain in ignored .env.",
    );
  } else {
    await migrate(pool);
    if (mode === "prepare") {
      const existing = new URL(env.DATABASE_URL ?? adminUrl);
      let runtimeUrl = existing;
      const role = await pool.query(
        "SELECT 1 FROM pg_roles WHERE rolname = 'ark_app'",
      );
      if (existing.username !== "ark_app") {
        if (role.rowCount)
          throw new Error(
            "ark_app already exists but local runtime credentials are missing. Resolve this role explicitly; it will not be overwritten.",
          );
        const password = randomBytes(24).toString("hex");
        const sql = await pool.query(
          "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', $1::text, $2::text) AS statement",
          ["ark_app", password],
        );
        await pool.query(sql.rows[0].statement);
        runtimeUrl = new URL(adminUrl);
        runtimeUrl.username = "ark_app";
        runtimeUrl.password = password;
        updates.MIGRATION_DATABASE_URL = adminUrl;
        updates.DATABASE_URL = runtimeUrl.toString();
        // Persist immediately after creation, so a later grant failure is safely retryable.
        saveEnv();
      } else if (!role.rowCount)
        throw new Error(
          "Configured runtime role is missing. Restore it explicitly.",
        );
      await pool.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
      await pool.query("GRANT CONNECT ON DATABASE ark_dev TO ark_app");
      await pool.query("GRANT USAGE ON SCHEMA public TO ark_app");
      await pool.query(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, users, organization_memberships, teams, team_memberships, auth_sessions TO ark_app",
      );
      await pool.query("GRANT SELECT, UPDATE ON bootstrap_state TO ark_app");
      await pool.query("GRANT SELECT, INSERT ON audit_events TO ark_app");
      await pool.query("GRANT SELECT ON schema_migrations TO ark_app");
      const runtime = createPool(runtimeUrl.toString());
      try {
        const check = await runtime.query(
          "SELECT current_user AS name, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = current_user",
        );
        const result = check.rows[0];
        if (
          result.name !== "ark_app" ||
          result.rolsuper ||
          result.rolcreatedb ||
          result.rolcreaterole ||
          result.rolbypassrls
        )
          throw new Error("Runtime role privileges are unsafe.");
        await runtime.query("SELECT version FROM schema_migrations");
      } finally {
        await runtime.end();
      }
      console.log(
        "Migrations applied. API runtime uses restricted ark_app; administrative credentials remain local.",
      );
    } else console.log("Migrations verified and applied.");
  }
} catch {
  // pg errors can contain connection or SQL literals. Keep terminal output safe.
  console.error(
    "Database preparation failed. Check Docker, local configuration, and role ownership. No credentials were printed.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
