import { revalidatePath } from "next/cache";
import { z } from "zod";
import { companyAllows } from "@/helpers/companies/require-company";
import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { createTalentList, deleteTalentList } from "@/helpers/pipeline/talent-lists";
import { parseCandidateFields, type CandidateFieldErrors } from "./candidate-schema";
import { IMPORT_MESSAGES, importCountsOf, importMessage, type ImportCounts } from "./copy";
import { MAX_SHEET_ROWS } from "./import-limits";
import { saveImportMapping } from "./import-mappings";
import type { ImportSession } from "./import-session";
import { COLUMN_TARGETS } from "./map-columns";
import { CANDIDATES_LIST_PATH } from "./paths";
import { DUPLICATE_ACTIONS } from "./preview-rows";

const uuid = z.string().uuid();
export const stageMapSchema = z
  .record(z.string().max(120), uuid)
  .refine((m) => Object.keys(m).length <= 200, "Too many stage values.");

export const confirmSpreadsheetSchema = z
  .object({
    batchId: uuid,
    rows: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_SHEET_ROWS),
    duplicateAction: z.enum(DUPLICATE_ACTIONS).default("skip"),
    jobPostId: uuid.optional(),
    stageId: uuid.optional(),
    stageMap: stageMapSchema.optional(),
    talentListId: uuid.optional(),
    newListName: z.string().trim().min(1).max(200).optional(),
    autoInvite: z.boolean().optional(),
    attested: z.boolean(),
    lawfulBasisNote: z.string().trim().max(200).optional(),
    /** Saved for the next file with the same headers (BI-REQ-011). */
    mapping: z
      .object({ headerHash: z.string().regex(/^[0-9a-f]{64}$/), columns: z.array(z.enum(COLUMN_TARGETS)).max(500) })
      .strict()
      .optional(),
  })
  .strict();

export type ConfirmSpreadsheetInput = z.output<typeof confirmSpreadsheetSchema>;

/** The first rows that failed the server's check, by their position in `rows`. */
export type RowErrors = { row: number; errors: CandidateFieldErrors }[];

export type ConfirmSpreadsheetResult =
  | { ok: true; batchId: string; counts: ImportCounts; newList: { id: string; slug: string; name: string } | null }
  | { ok: false; error: string; rowErrors?: RowErrors };

const MAX_ROW_ERRORS = 20;

/**
 * BI-REQ-015/016/017: confirms a spreadsheet batch. Every row is validated
 * again here with the candidate schema; any failure refuses the whole import.
 * Needs applicants.import for the job (or unscoped without one), which the
 * caller checked, and talent_lists.manage for a list, which it can create.
 * `confirm_candidate_import` repeats the checks and does the rest in one
 * transaction. Nobody is emailed (BI-REQ-015c). Shared by
 * `confirmSpreadsheetImportAction` and the agent's staged sheets
 * (`confirmStagedSpreadsheet`).
 */
export async function confirmSpreadsheetRows(
  auth: ImportSession,
  input: ConfirmSpreadsheetInput,
): Promise<ConfirmSpreadsheetResult> {
  const { batchId, duplicateAction, jobPostId, stageId, stageMap, talentListId, newListName, attested } = input;

  const toList = !!talentListId || !!newListName;
  if (talentListId && newListName) return { ok: false, error: IMPORT_MESSAGES.invalid };
  if (toList) {
    const denied = companyAllows(auth.company, { permission: "talent_lists.manage" });
    if (denied) return { ok: false, error: denied };
  }
  if (!attested) return { ok: false, error: IMPORT_MESSAGES.not_attested };
  if (!jobPostId && (stageId || stageMap)) return { ok: false, error: IMPORT_MESSAGES.invalid };

  // Every row again, with the same schema as the preview (BI-DEC-004).
  const rows: Record<string, unknown>[] = [];
  const rowErrors: RowErrors = [];
  input.rows.forEach((raw, row) => {
    const { duplicate_action, ...fields } = raw;
    const result = parseCandidateFields(fields, { withJob: !!jobPostId });
    const action = duplicate_action === undefined ? null : DUPLICATE_ACTIONS.find((a) => a === duplicate_action);
    if (!result.ok || action === undefined) {
      if (rowErrors.length < MAX_ROW_ERRORS) {
        rowErrors.push({ row, errors: result.ok ? { duplicate_action: "Not a duplicate action." } : result.errors });
      }
      return;
    }
    const clean = Object.fromEntries(Object.entries(result.data).filter(([, v]) => v !== undefined));
    rows.push(action ? { ...clean, duplicate_action: action } : clean);
  });
  if (rowErrors.length > 0) {
    return { ok: false, error: "Some rows aren't valid. Fix them in the preview and try again.", rowErrors };
  }

  if (jobPostId && (stageId || stageMap)) {
    const { data: stages, error } = await auth.supabase
      .from("pipeline_stages")
      .select("id")
      .eq("company_id", auth.company.id)
      .eq("archived", false);
    if (error) throw new Error(`Failed to load the stages: ${error.message}`);
    const ids = new Set((stages ?? []).map((s) => s.id));
    const wanted = [...(stageId ? [stageId] : []), ...Object.values(stageMap ?? {})];
    if (wanted.some((id) => !ids.has(id))) return { ok: false, error: IMPORT_MESSAGES.invalid_stage };
  }

  // Locations are saved in their canonical spelling, as the profile form does.
  const locations = [...new Set(rows.flatMap((r) => (typeof r.location === "string" ? [r.location] : [])))];
  const canonical = new Map(
    await Promise.all(locations.map(async (l) => [l, (await canonicalizeLocations([l]))[0] ?? l] as const)),
  );
  for (const row of rows) if (typeof row.location === "string") row.location = canonical.get(row.location);

  let listId = talentListId ?? null;
  let newList: { id: string; slug: string; name: string } | null = null;
  if (newListName) {
    const created = await createTalentList(auth, newListName);
    if (!created.ok) return { ok: false, error: created.error };
    newList = { id: created.list.id, slug: created.list.slug, name: created.list.name };
    listId = created.list.id;
  }

  // A list made for this import goes again if the import doesn't go through.
  const dropNewList = async () => {
    if (newList) await deleteTalentList(auth, newList.id).catch(() => {});
  };

  const { data, error } = await auth.supabase.rpc("confirm_candidate_import", {
    p_batch_id: batchId,
    p_rows: rows as never,
    p_options: {
      attested: true,
      duplicate_action: duplicateAction,
      ...(input.lawfulBasisNote ? { lawful_basis_note: input.lawfulBasisNote } : {}),
      ...(listId ? { talent_list_id: listId } : {}),
      ...(jobPostId
        ? {
            job_post_id: jobPostId,
            ...(stageId ? { stage_id: stageId } : {}),
            ...(stageMap ? { stage_map: stageMap } : {}),
            auto_invite: input.autoInvite === true,
          }
        : {}),
    },
  });
  if (error) {
    await dropNewList();
    throw new Error(`Failed to confirm the import: ${error.message}`);
  }
  const result = data as { ok: boolean; reason?: string; counts?: unknown };
  if (!result.ok) {
    await dropNewList();
    return { ok: false, error: importMessage(result.reason) };
  }

  if (input.mapping) {
    await saveImportMapping(auth.company.id, input.mapping.headerHash, {
      columns: input.mapping.columns,
      ...(stageMap ? { stageMap } : {}),
    });
  }

  revalidatePath(CANDIDATES_LIST_PATH);
  // A talent list's tab shows its candidates too.
  revalidatePath("/company/profiles");
  if (jobPostId) {
    revalidatePath(`/company/job-posts/${jobPostId}`);
    revalidatePath(`/company/job-posts/${jobPostId}/applications`);
  }
  return { ok: true, batchId, counts: importCountsOf(result.counts), newList };
}
