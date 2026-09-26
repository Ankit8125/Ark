import { createPool } from "@ark/db";
import { buildApp } from "./app.js";

const connection = process.env.DATABASE_URL;
if (!connection)
  throw new Error(
    "DATABASE_URL is missing. Run setup:env and db:prepare first.",
  );
const port = Number(process.env.ARK_API_PORT ?? "3001");
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid ARK_API_PORT.");
const webPort = Number(process.env.ARK_WEB_PORT ?? "5173");
if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65535)
  throw new Error("Invalid ARK_WEB_PORT.");
const pool = createPool(connection);
pool.on("error", () => {
  console.error("An idle database connection failed.");
});
const app = await buildApp({
  pool,
  logger: true,
  allowedHosts: [
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `127.0.0.1:${webPort}`,
    `localhost:${webPort}`,
  ],
  allowedOrigins: [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://127.0.0.1:${webPort}`,
    `http://localhost:${webPort}`,
  ],
});
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await app.close();
  await pool.end();
};
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
try {
  await app.listen({ host: "127.0.0.1", port });
} catch {
  console.error("API startup failed. Check the local port and configuration.");
  await shutdown();
  process.exitCode = 1;
}
