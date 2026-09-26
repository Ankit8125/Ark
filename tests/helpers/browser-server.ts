import { buildApp } from "../../apps/api/src/app.js";
import { databaseFixture } from "./database.js";

// Browser QA gets an empty, disposable schema in ark_test, never ark_dev.
const fixture = await databaseFixture();
const app = await buildApp({
  pool: fixture.pool,
  allowedHosts: [
    "127.0.0.1:3002",
    "localhost:3002",
    "127.0.0.1:5184",
    "localhost:5184",
  ],
  allowedOrigins: ["http://127.0.0.1:5184", "http://localhost:5184"],
});
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  await app.close();
  await fixture.close();
}
process.on("SIGINT", () => {
  void stop();
});
process.on("SIGTERM", () => {
  void stop();
});
try {
  await app.listen({ host: "127.0.0.1", port: 3002 });
  console.log("Disposable browser-test API ready at 127.0.0.1:3002.");
} catch {
  await stop();
  throw new Error("Could not start browser-test API.");
}
