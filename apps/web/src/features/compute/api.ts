import {
  RunnerListResponseSchema,
  RunnerResponseSchema,
  type CreateRunnerEnrollmentRequest,
  type RevokeRunnerRequest,
} from "@ark/contracts";
import { requestJson } from "../../api";

function runnerResponse(teamId: string, runnerId: string) {
  return {
    parse(value: unknown) {
      const response = RunnerResponseSchema.parse(value);
      if (response.runner.teamId !== teamId || response.runner.id !== runnerId)
        throw new Error("Unexpected runner identity");
      return response;
    },
  };
}

export const computeApi = {
  list(teamId: string, cursor?: string, signal?: AbortSignal) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return requestJson(
      `/api/teams/${encodeURIComponent(teamId)}/runners${query}`,
      {
        parse(value: unknown) {
          const response = RunnerListResponseSchema.parse(value);
          if (
            response.runners.some((runner) => runner.teamId !== teamId) ||
            new Set(response.runners.map((runner) => runner.id)).size !==
              response.runners.length
          )
            throw new Error("Unexpected runner list");
          return response;
        },
      },
      { signal },
    );
  },
  issue(
    teamId: string,
    input: CreateRunnerEnrollmentRequest,
    signal?: AbortSignal,
  ) {
    return requestJson(
      `/api/teams/${encodeURIComponent(teamId)}/runner-enrollments`,
      runnerResponse(teamId, input.id),
      { method: "POST", body: JSON.stringify(input), signal },
    );
  },
  revoke(
    teamId: string,
    runnerId: string,
    input: RevokeRunnerRequest,
    signal?: AbortSignal,
  ) {
    return requestJson(
      `/api/teams/${encodeURIComponent(teamId)}/runners/${encodeURIComponent(runnerId)}/revoke`,
      {
        parse(value: unknown) {
          const response = runnerResponse(teamId, runnerId).parse(value);
          if (!response.runner.revokedAt)
            throw new Error("Runner was not revoked");
          return response;
        },
      },
      { method: "POST", body: JSON.stringify(input), signal },
    );
  },
};

export function createEnrollment(name: string): CreateRunnerEnrollmentRequest {
  const id = crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return { id, name, enrollmentToken: `ark_enroll_${id}_${secret}` };
}
