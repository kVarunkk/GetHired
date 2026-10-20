"use server";

import { z } from "zod";
import { AUDIT_ACTION_GROUP_VALUES, type AuditEntry } from "@/helpers/companies/audit";
import { listAudit } from "@/helpers/companies/list-audit";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { requireCompanyForAction } from "@/helpers/companies/require-company";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const inputSchema = z
  .object({
    before: z.number().int().positive(),
    actor: z.string().uuid().nullish(),
    action: z.enum(AUDIT_ACTION_GROUP_VALUES).nullish(),
    since: day.nullish(),
    until: day.nullish(),
  })
  .strict();

/**
 * SERVER ACTION (RP-REQ-015): the next page of the audit log ("Load more").
 * Needs audit.view; the RPC checks it again and scopes to the session company.
 */
export async function listAuditAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true; entries: AuditEntry[]; nextBefore: number | null } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "audit.view" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't load more entries." };

  const { before, ...filters } = parsed.data;
  try {
    const page = await listAudit(auth.supabase, filters, before);
    if (!page) return { ok: false, error: forbiddenMessage("audit.view") };
    return { ok: true, ...page };
  } catch {
    return { ok: false, error: "Couldn't load more entries." };
  }
}
