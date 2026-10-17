import { z } from "zod";
import { PERMISSION_KEYS, ROLE_LIMIT_KEYS, type PermissionKey } from "./permissions";
import { ROLE_COLORS } from "./role-templates";

// RP-TEST-006: what the role actions and the agent's role tools accept. Only
// catalog keys and scopes; the RPC adds dependencies and checks the ceiling.

export const permissionKeySchema = z.enum(PERMISSION_KEYS as [PermissionKey, ...PermissionKey[]]);

export const grantSchema = z
  .object({ key: permissionKeySchema, scope: z.enum(["all", "assigned"]).default("all") })
  .strict();

export const grantsSchema = z.array(grantSchema).max(PERMISSION_KEYS.length);

export const limitsSchema = z
  .object(
    Object.fromEntries(ROLE_LIMIT_KEYS.map((k) => [k, z.number().int().min(0).max(1_000_000).optional()])) as Record<
      (typeof ROLE_LIMIT_KEYS)[number],
      z.ZodOptional<z.ZodNumber>
    >,
  )
  .strict();

export const roleNameSchema = z.string().trim().min(1, "Give the role a name.").max(40, "Use 40 characters or fewer.");
export const roleDescriptionSchema = z.string().trim().max(200, "Use 200 characters or fewer.");
export const roleColorSchema = z.enum(ROLE_COLORS);

export const roleFieldsSchema = z
  .object({
    name: roleNameSchema,
    description: roleDescriptionSchema.optional().default(""),
    color: roleColorSchema.default("slate"),
    grants: grantsSchema,
    limits: limitsSchema.default({}),
  })
  .strict();

export type RoleFields = z.infer<typeof roleFieldsSchema>;

/** Drops undefined limits, so the RPC gets `{ key: n }` only. */
export function limitsPayload(limits: z.infer<typeof limitsSchema>): Record<string, number> {
  return Object.fromEntries(Object.entries(limits).filter(([, v]) => typeof v === "number")) as Record<
    string,
    number
  >;
}
