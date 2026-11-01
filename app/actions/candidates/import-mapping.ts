"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { savedMappingSchema, type SavedMapping } from "@/helpers/candidates/map-columns";

const inputSchema = z.object({ headerHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict();

export type GetImportMappingResult = { ok: true; mapping: SavedMapping | null } | { ok: false; error: string };

/**
 * SERVER ACTION (BI-REQ-011): the mapping the company last confirmed for this
 * header set, so a repeat export from the same tool maps itself. Read through
 * RLS (applicants.import at any scope). A saved mapping that no longer
 * parses reads as none. Saved by `confirmSpreadsheetImportAction`.
 */
export async function getImportMappingAction(input: z.input<typeof inputSchema>): Promise<GetImportMappingResult> {
  const auth = await requireCompanyForAction({ permission: "applicants.import" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't load the saved mapping." };

  const { data, error } = await auth.supabase
    .from("candidate_import_mappings")
    .select("mapping")
    .eq("company_id", auth.company.id)
    .eq("header_hash", parsed.data.headerHash)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the import mapping: ${error.message}`);

  const mapping = data ? savedMappingSchema.safeParse(data.mapping) : null;
  return { ok: true, mapping: mapping?.success ? mapping.data : null };
}
