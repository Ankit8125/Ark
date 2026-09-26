import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

const passwordOptions = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, passwordOptions);
}

// A process-local random dummy hash gives unknown accounts the same expensive
// password-verification path without creating an account or persisting a secret.
let dummyHash: Promise<string> | undefined;

export async function verifyPassword(
  password: string,
  storedHash: string | undefined,
): Promise<boolean> {
  dummyHash ??= hashPassword(randomBytes(32).toString("hex"));
  const candidate = storedHash ?? (await dummyHash);
  try {
    return (await verify(candidate, password)) && storedHash !== undefined;
  } catch {
    return false;
  }
}

export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function sessionTokenHash(
  token: string | undefined,
): string | undefined {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return undefined;
  return createHash("sha256").update(token).digest("hex");
}
