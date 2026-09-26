import { ApiErrorSchema, MeResponseSchema, TeamSchema } from "@ark/contracts";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: Record<string, string[]>;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

async function request(path: string, options: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiRequestError(
      0,
      "OFFLINE",
      "Cannot reach Ark. Check that the local API is running, then try again.",
    );
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const parsed = ApiErrorSchema.safeParse(body);
    if (parsed.success) {
      const { code, message, fieldErrors } = parsed.data.error;
      throw new ApiRequestError(response.status, code, message, fieldErrors);
    }
    throw new ApiRequestError(
      response.status,
      "REQUEST_FAILED",
      "Ark could not complete this request. Please try again.",
    );
  }
  return response;
}

async function json<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  options?: RequestInit,
): Promise<T> {
  const response = await request(path, options);
  try {
    return schema.parse(await response.json());
  } catch {
    throw new ApiRequestError(
      502,
      "INVALID_RESPONSE",
      "Ark returned an unexpected response. Please retry.",
    );
  }
}

export const api = {
  async bootstrapStatus(signal?: AbortSignal) {
    const response = await request("/api/bootstrap/status", { signal });
    const value: unknown = await response.json();
    if (
      !value ||
      typeof value !== "object" ||
      !("required" in value) ||
      typeof value.required !== "boolean"
    ) {
      throw new ApiRequestError(
        502,
        "INVALID_RESPONSE",
        "Ark could not check setup. Please retry.",
      );
    }
    return value.required;
  },
  me: (signal?: AbortSignal) => json("/api/me", MeResponseSchema, { signal }),
  authenticate: (mode: "setup" | "login", body: unknown) =>
    json(
      mode === "setup" ? "/api/bootstrap" : "/api/auth/login",
      MeResponseSchema,
      { method: "POST", body: JSON.stringify(body) },
    ),
  team: (id: string, signal?: AbortSignal) =>
    json(
      `/api/teams/${encodeURIComponent(id)}`,
      {
        parse(value: unknown) {
          if (!value || typeof value !== "object" || !("team" in value))
            throw new Error("Missing team");
          const team = TeamSchema.parse(value.team);
          if (team.id !== id) throw new Error("Unexpected team");
          return team;
        },
      },
      { signal },
    ),
  async logout() {
    await request("/api/auth/logout", { method: "POST", body: "{}" });
  },
};

export function errorMessage(error: unknown) {
  return error instanceof ApiRequestError
    ? error.message
    : "Something went wrong. Please try again.";
}
