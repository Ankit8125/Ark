import { describe, expect, it } from "vitest";
import { BootstrapRequestSchema, LoginRequestSchema } from "@ark/contracts";

const setup = {
  ownerName: "Owner",
  email: "owner@example.test",
  password: "a-long-test-password",
  organizationName: "Example",
  teamName: "Build",
};
describe("identity contracts", () => {
  it("normalizes identity fields without altering passwords", () => {
    const result = BootstrapRequestSchema.parse({
      ...setup,
      email: " OWNER@EXAMPLE.TEST ",
      ownerName: " Owner ",
      password: "  a-long-test-password  ",
    });
    expect(result.email).toBe("owner@example.test");
    expect(result.ownerName).toBe("Owner");
    expect(result.password).toBe("  a-long-test-password  ");
  });
  it("rejects unknown authority fields, blank names, invalid email, and weak setup passwords", () => {
    for (const change of [
      { role: "owner" },
      { teamName: " " },
      { email: "bad" },
      { password: "short" },
      { password: "x".repeat(129) },
    ]) {
      expect(
        BootstrapRequestSchema.safeParse({ ...setup, ...change }).success,
      ).toBe(false);
    }
  });
  it("accepts login attempts independently of setup password policy", () => {
    expect(
      LoginRequestSchema.safeParse({ email: setup.email, password: "wrong" })
        .success,
    ).toBe(true);
    expect(
      LoginRequestSchema.safeParse({ email: setup.email, password: "" })
        .success,
    ).toBe(false);
  });
});
