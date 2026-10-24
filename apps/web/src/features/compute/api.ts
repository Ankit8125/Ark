import {
  RunnerListResponseSchema,
  RunnerResponseSchema,
  RunnerGrantsResponseSchema,
  RunnerUseAccessResponseSchema,
  type CreateRunnerEnrollmentRequest,
  type RevokeRunnerRequest,
  type SetRunnerDispatchApprovalRequest,
  type SetRunnerUseGrantRequest,
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
  grants(
    teamId: string,
    runnerId: string,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return requestJson(
      `/api/teams/${encodeURIComponent(teamId)}/runners/${encodeURIComponent(runnerId)}/grants${query}`,
      {
        parse(value: unknown) {
          const response = RunnerGrantsResponseSchema.parse(value);
          if (
            response.runner.teamId !== teamId ||
            response.runner.id !== runnerId ||
            new Set(response.members.map((member) => member.userId)).size !==
              response.members.length
          )
            throw new Error("Unexpected runner grant list");
          return response;
        },
      },
      { signal },
    );
  },
  useAccess(teamId: string, runnerId: string, signal?: AbortSignal) {
    return requestJson(
      `/api/teams/${encodeURIComponent(teamId)}/runners/${encodeURIComponent(runnerId)}/use-access`,
      {
        parse(value: unknown) {
          const response = RunnerUseAccessResponseSchema.parse(value);
          if (
            response.runner.teamId !== teamId ||
            response.runner.id !== runnerId
          )
            throw new Error("Unexpected runner identity");
          return response;
        },
      },
      { signal },
    );
  },
  setApproval(
    teamId: string,
    runnerId: string,
    input: SetRunnerDispatchApprovalRequest,
    signal?: AbortSignal,
  ) {
    return requestJson(
      `/api/teams/${encodeURIComponent(teamId)}/runners/${encodeURIComponent(runnerId)}/dispatch-approval`,
      {
        parse(value: unknown) {
          const response = runnerResponse(teamId, runnerId).parse(value);
          if (response.runner.dispatchApproved !== input.approved)
            throw new Error("Unexpected runner approval");
          return response;
        },
      },
      { method: "POST", body: JSON.stringify(input), signal },
    );
  },
  setGrant(
    teamId: string,
    runnerId: string,
    userId: string,
    input: SetRunnerUseGrantRequest,
    signal?: AbortSignal,
  ) {
    return requestJson(
      `/api/teams/${encodeURIComponent(teamId)}/runners/${encodeURIComponent(runnerId)}/grants/${encodeURIComponent(userId)}`,
      runnerResponse(teamId, runnerId),
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
