import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "@ark/db";

function transactionFixture(failures: Record<string, Error> = {}) {
  const query = vi.fn(async (sql: string) => {
    if (failures[sql]) throw failures[sql];
    return { rows: [] };
  });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const pool = {
    connect: vi.fn(async () => client),
  } as unknown as Pool;
  return { pool, client, query, release };
}

describe("transaction connection lifecycle", () => {
  it("commits on the same connection and releases it once", async () => {
    const fixture = transactionFixture();
    const result = await withTransaction(fixture.pool, async (client) => {
      expect(client).toBe(fixture.client);
      await client.query("work");
      return "saved";
    });
    expect(result).toBe("saved");
    expect(fixture.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      "work",
      "COMMIT",
    ]);
    expect(fixture.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("rolls back a failed operation without replacing its error", async () => {
    const failure = new Error("Operation failed");
    const fixture = transactionFixture({ work: failure });
    await expect(
      withTransaction(fixture.pool, (client) => client.query("work")),
    ).rejects.toBe(failure);
    expect(fixture.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      "work",
      "ROLLBACK",
    ]);
    expect(fixture.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("discards a connection when rollback fails and retains the original error", async () => {
    const failure = new Error("Operation failed");
    const fixture = transactionFixture({
      work: failure,
      ROLLBACK: new Error("Connection lost during rollback"),
    });
    await expect(
      withTransaction(fixture.pool, (client) => client.query("work")),
    ).rejects.toBe(failure);
    expect(fixture.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      "work",
      "ROLLBACK",
    ]);
    expect(fixture.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it.each(["BEGIN", "COMMIT"])(
    "releases after a failed %s",
    async (command) => {
      const failure = new Error(`${command} failed`);
      const fixture = transactionFixture({ [command]: failure });
      const operation = vi.fn(async () => "saved");
      await expect(withTransaction(fixture.pool, operation)).rejects.toBe(
        failure,
      );
      expect(fixture.query).toHaveBeenLastCalledWith("ROLLBACK");
      expect(operation).toHaveBeenCalledTimes(command === "BEGIN" ? 0 : 1);
      expect(fixture.release).toHaveBeenCalledExactlyOnceWith(false);
    },
  );

  it("does not run work when acquiring a connection fails", async () => {
    const failure = new Error("Pool unavailable");
    const pool = {
      connect: vi.fn().mockRejectedValue(failure),
    } as unknown as Pool;
    const operation = vi.fn();
    await expect(withTransaction(pool, operation)).rejects.toBe(failure);
    expect(operation).not.toHaveBeenCalled();
  });
});
