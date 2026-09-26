import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { databaseFixture } from "../helpers/database.js";

it("restores setup and authentication after a real API process restart", async () => {
  const fixture = await databaseFixture();
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("No test port.");
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const start = () =>
    spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../apps/api/dist/server.js", import.meta.url),
        ),
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: fixture.connection,
          ARK_API_PORT: String(port),
        },
        stdio: "ignore",
        windowsHide: true,
      },
    );
  let child: ReturnType<typeof start> | undefined;
  async function ready() {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child?.exitCode !== null)
        throw new Error("Test API exited before becoming ready.");
      try {
        if ((await fetch(`${origin}/api/health/ready`)).ok) return;
      } catch {
        /* Wait for listener. */
      }
      await delay(50);
    }
    throw new Error("Test API readiness timed out.");
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, "exit");
    child.kill();
    await exited;
    child = undefined;
  }
  try {
    child = start();
    await ready();
    const response = await fetch(`${origin}/api/bootstrap`, {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ownerName: "Restart Test",
        email: "restart@example.test",
        password: "restart-test-password",
        organizationName: "Restart Example",
        teamName: "Build",
      }),
    });
    expect(response.status).toBe(201);
    const initial = await response.json();
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    await stop();
    child = start();
    await ready();
    expect(
      await (await fetch(`${origin}/api/bootstrap/status`)).json(),
    ).toEqual({ required: false });
    const restored = await fetch(`${origin}/api/me`, {
      headers: { cookie: cookie! },
    });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toEqual(initial);
  } finally {
    await stop();
    await fixture.close();
  }
});
