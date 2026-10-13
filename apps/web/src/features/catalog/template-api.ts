import {
  CatalogTemplateListResponseSchema,
  type CatalogTemplateKind,
} from "@ark/contracts";
import { requestJson } from "../../api";

export const templateApi = {
  list(teamId: string, kind: CatalogTemplateKind, signal?: AbortSignal) {
    return requestJson(
      `/api/teams/${encodeURIComponent(teamId)}/templates/${kind}`,
      {
        parse(value: unknown) {
          const response = CatalogTemplateListResponseSchema.parse(value);
          if (response.templates.some((template) => template.kind !== kind))
            throw new Error("Unexpected template kind");
          return response;
        },
      },
      { signal },
    );
  },
};
