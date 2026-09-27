import { z } from "zod";

// PostgreSQL text/jsonb cannot represent NUL or unpaired UTF-16 surrogates.
// Unicode mode treats valid surrogate pairs as one code point, preserving emoji.
export const CatalogTextSchema = z.string().refine(
  // oxlint-disable-next-line no-control-regex -- Intentionally rejects PostgreSQL-incompatible characters.
  (value) => !/[\u0000\uD800-\uDFFF]/u.test(value),
  "Use valid Unicode text without null characters.",
);
