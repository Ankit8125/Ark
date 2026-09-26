import { z } from "zod";

const name = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(80, "Use 80 characters or fewer.");
const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email("Enter a valid email address.");
const password = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128, "Use 128 characters or fewer.");
export const BootstrapRequestSchema = z.strictObject({
  ownerName: name,
  email,
  password,
  organizationName: name,
  teamName: name,
});
export const LoginRequestSchema = z.strictObject({
  email,
  password: z.string().min(1).max(128),
});
export const TeamSchema = z.strictObject({
  id: z.uuid(),
  name,
  role: z.enum(["admin", "developer", "reviewer", "viewer"]),
});
export const MeResponseSchema = z.strictObject({
  user: z.strictObject({ id: z.uuid(), name, email }),
  organization: z.strictObject({
    id: z.uuid(),
    name,
    role: z.enum(["owner", "admin", "member"]),
  }),
  teams: z.array(TeamSchema),
});
export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  }),
});
export type BootstrapRequest = z.infer<typeof BootstrapRequestSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type MeResponse = z.infer<typeof MeResponseSchema>;
export type Team = z.infer<typeof TeamSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
