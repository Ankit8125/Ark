import { describe, expect, it } from "vitest";
import { parseLocalDatabaseUrl } from "../../scripts/lib/local-database-url.mjs";

const development = "postgresql://example:placeholder@127.0.0.1:5434/ark_dev";
const test = "postgres://example:placeholder@localhost:5434/ark_test";

describe("local database URL boundary", () => {
  it("accepts the declared loopback databases and PostgreSQL schemes", () => {
    expect(parseLocalDatabaseUrl(development, "ark_dev", "5434").pathname).toBe(
      "/ark_dev",
    );
    expect(parseLocalDatabaseUrl(test, "ark_test").hostname).toBe("localhost");
  });

  it.each([
    "?host=remote.example",
    "?host=",
    "?port=6543",
    "?user=other",
    "?password=other",
    "?options=-csearch_path=public",
    "?db=other",
    "?sslmode=no-verify",
    "#fragment",
  ])("rejects external connection modifiers: %s", (modifier) => {
    expect(() =>
      parseLocalDatabaseUrl(`${development}${modifier}`, "ark_dev", "5434"),
    ).toThrow("without query parameters or fragments");
    expect(() =>
      parseLocalDatabaseUrl(`${test}${modifier}`, "ark_test"),
    ).toThrow("without query parameters or fragments");
  });

  it.each([
    "https://example:placeholder@127.0.0.1:5434/ark_dev",
    "socket://example:placeholder@127.0.0.1:5434/ark_dev",
    "postgres://example:placeholder@remote.example:5434/ark_dev",
    "postgres://example:placeholder@127.0.0.1:6543/ark_dev",
    "postgres://example:placeholder@127.0.0.1:5434/ark_test",
  ])("rejects an unapproved maintenance destination: %s", (connection) => {
    expect(() =>
      parseLocalDatabaseUrl(connection, "ark_dev", "5434"),
    ).toThrow();
  });

  it("never permits the development database for test fixtures", () => {
    expect(() => parseLocalDatabaseUrl(development, "ark_test")).toThrow();
  });

  it("allows trusted fixture code to add schema options after validation", () => {
    const url = parseLocalDatabaseUrl(test, "ark_test");
    url.searchParams.set(
      "options",
      "-csearch_path=ark_test_0123456789abcdef0123",
    );
    expect(url.hostname).toBe("localhost");
    expect(url.pathname).toBe("/ark_test");
    expect(url.searchParams.get("options")).toBe(
      "-csearch_path=ark_test_0123456789abcdef0123",
    );
  });

  it("withholds the input and parser cause on invalid URLs", () => {
    const input = "postgres://example:placeholder@[malformed";
    try {
      parseLocalDatabaseUrl(input, "ark_dev", "5434");
      expect.fail("Expected an invalid URL to be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "Local database URL is invalid; its value is withheld.",
      );
      expect(error).not.toHaveProperty("cause");
      expect(String(error)).not.toContain("placeholder");
    }
  });
});
