import { ApiErrorSchema } from "@ark/contracts";
import type { FastifyReply } from "fastify";
import type { ZodType } from "zod";

export class ApiFailure extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly fieldErrors: Record<string, string[]> | undefined;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiFailure";
    this.statusCode = statusCode;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export function parseRequest<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;

  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  throw new ApiFailure(
    400,
    "VALIDATION_ERROR",
    "Check the submitted fields.",
    fieldErrors,
  );
}

export function sendFailure(
  reply: FastifyReply,
  failure: ApiFailure,
): FastifyReply {
  const error = {
    code: failure.code,
    message: failure.message,
    ...(failure.fieldErrors ? { fieldErrors: failure.fieldErrors } : {}),
  };
  return reply.code(failure.statusCode).send(ApiErrorSchema.parse({ error }));
}
