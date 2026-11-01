import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { companyAllows } from "@/helpers/companies/require-company";
import { CANDIDATE_FIELD_KEYS, type CandidateFieldErrors } from "./candidate-schema";
import { confirmSpreadsheetRows, stageMapSchema, type ConfirmSpreadsheetResult } from "./confirm-spreadsheet";
import { IMPORT_MESSAGES, importMessage } from "./copy";
import { matchImportEmails } from "./email-matches";
import { MAX_SHEET_ROWS } from "./import-limits";
import { saveImportMapping } from "./import-mappings";
import { importRowView, isInFlight, needsEmail, type DuplicateAction, type ImportRowView } from "./import-rows";
import type { ImportSession } from "./import-session";
import { COLUMN_TARGETS, type MappedRow } from "./map-columns";
import { candidateImportPath, CANDIDATES_LIST_PATH, jobImportPath } from "./paths";
import { DUPLICATE_ACTIONS, previewRows, rowsToConfirm, type PreviewStatus } from "./preview-rows";
import { resumeErrorMessage } from "./resume-files";
import { stageValues } from "./stage-map";

// Imports the recruiter agent works on (BI-REQ-060). A resume batch's rows
// are on the server already; a spreadsheet's are staged there by the chat's
// spreadsheet widget (stageSpreadsheet), so the agent can read, fix and
// confirm them the way the import page does in the browser.

/** A staged cell: the mapped text of one column, as `applyMapping` makes it. */
const cell = z.string().max(5000);

export const stageSpreadsheetSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    /** Kept on the batch, so a member who imports for this job only can fix its rows. */
    jobPostId: z.string().uuid().optional(),
    rows: z
      .array(z.record(z.enum([...CANDIDATE_FIELD_KEYS, "stage"]), cell))
      .min(1)
      .max(MAX_SHEET_ROWS),
    /** Saved for the next file with the same headers (BI-REQ-011). */
    mapping: z
      .object({ headerHash: z.string().regex(/^[0-9a-f]{64}$/), columns: z.array(z.enum(COLUMN_TARGETS)).max(500) })
      .strict()
      .optional(),
  })
  .strict();

export type StageSpreadsheetInput = z.output<typeof stageSpreadsheetSchema>;
export type StageSpreadsheetResult = { ok: true; batchId: string; rows: number } | { ok: false; error: string };

/**
 * Opens a draft spreadsheet batch (BI-SEC-008's 5-an-hour, 20-a-day limits)
 * and stages its mapped rows (`stage_spreadsheet_import`), which the
 * expiry cron deletes after 7 days if they're never confirmed. The caller
 * has checked applicants.import for the job, or unscoped without one.
 */
export async function stageSpreadsheet(auth: ImportSession, input: StageSpreadsheetInput): Promise<StageSpreadsheetResult> {
  const { data: started, error: startError } = await auth.supabase.rpc("start_candidate_import", {
    p_kind: "spreadsheet",
    p_file_name: input.fileName,
  });
  if (startError) throw new Error(`Failed to start the import: ${startError.message}`);
  const start = started as { ok: boolean; reason?: string; batch_id?: string };
  if (!start.ok || !start.batch_id) return { ok: false, error: importMessage(start.reason) };

  const { data, error } = await auth.supabase.rpc("stage_spreadsheet_import", {
    p_batch_id: start.batch_id,
    // The generated type says string; the function takes null for no job.
    p_job_id: input.jobPostId ?? (null as unknown as string),
    p_rows: input.rows as never,
  });
  if (error) throw new Error(`Failed to stage the rows: ${error.message}`);
  const staged = data as { ok: boolean; reason?: string; rows?: number };
  if (!staged.ok) return { ok: false, error: importMessage(staged.reason) };

  if (input.mapping) await saveImportMapping(auth.company.id, input.mapping.headerHash, { columns: input.mapping.columns });
  return { ok: true, batchId: start.batch_id, rows: staged.rows ?? input.rows.length };
}

/** A row's state in the review, for either kind of batch. */
export type ReviewStatus = PreviewStatus | "reading" | "failed" | "needs_email";

export type ReviewRow = {
  id: string;
  /** The file name, or "Row 12" for a spreadsheet. */
  label: string;
  status: ReviewStatus;
  fields: Record<string, unknown>;
  errors: CandidateFieldErrors;
  /** Fields the resume reader couldn't use, with why (never the value). */
  warnings: { field: string; message: string }[];
  /** A failed resume's reason. */
  failure: string | null;
  /** `existing`: the company candidate the email belongs to. */
  existingId: string | null;
  /** `known`: the GetHired user the email belongs to. */
  knownUserId: string | null;
  duplicateAction: DuplicateAction | null;
  /** A spreadsheet row with a job destination but no email: imported, not added to the job. */
  noEmailForJob: boolean;
  /** With a job: the application will have enough detail to be scored. */
  scored: boolean;
};

export type ImportReview = {
  batch: {
    id: string;
    kind: "spreadsheet" | "resumes";
    status: string;
    fileName: string | null;
    jobPostId: string | null;
    jobTitle: string | null;
    expiresAt: string;
    confirmedAt: string | null;
    /** The confirm's counts, once confirmed. */
    counts: unknown;
    /** Where the member reviews it on the site. */
    url: string;
  };
  rows: ReviewRow[];
  counts: Partial<Record<ReviewStatus, number>>;
  /** With a job: applications that will use a screening, and those that won't be scored yet. */
  job: { scored: number; unscored: number } | null;
  /** A spreadsheet's distinct Stage values, for `stageMap`. */
  stageValues: string[];
};

const BATCH_COLUMNS =
  "id, kind, status, file_name, job_post_id, expires_at, confirmed_at, counts, job_postings(title)" as const;
const ROW_COLUMNS =
  "id, file_name, row_number, status, error_code, extracted, edited, warnings, duplicate_of, duplicate_action, created_at" as const;

/**
 * Everything about one import, read through RLS (the batch's company, and
 * applicants.view for its job). Rows are validated as Confirm will validate
 * them, against the batch's job, and their emails checked against the
 * company's candidates and the GetHired users the member can see
 * (BI-REQ-014/019). Null when the batch isn't visible.
 */
export async function reviewImport(auth: ImportSession, batchId: string): Promise<ImportReview | null> {
  const { data: batch, error } = await auth.supabase
    .from("candidate_import_batches")
    .select(BATCH_COLUMNS)
    .eq("id", batchId)
    .eq("company_id", auth.company.id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the import: ${error.message}`);
  if (!batch) return null;
  const kind = batch.kind === "resumes" ? "resumes" : "spreadsheet";

  const { data: rawRows, error: rowsError } = await auth.supabase
    .from("candidate_import_rows")
    .select(ROW_COLUMNS)
    .eq("batch_id", batch.id)
    .in("status", ["queued", "parsing", "parsed", "failed"])
    .order("row_number", { ascending: true, nullsFirst: false })
    .order("created_at")
    .order("id");
  if (rowsError) throw new Error(`Failed to load the import: ${rowsError.message}`);
  const views: ImportRowView[] = (rawRows ?? []).map(importRowView);

  const withJob = !!batch.job_post_id;
  const parsed = views.filter((v) => v.status === "parsed");
  const emails = parsed.flatMap((v) => (typeof v.fields.email === "string" ? [v.fields.email] : []));
  const matches = await matchImportEmails(auth.supabase, auth.company.id, emails);
  const preview = previewRows(
    parsed.map((v) => v.fields as MappedRow),
    { matches, withJob: withJob && kind === "spreadsheet" },
  );
  const previewOf = new Map(parsed.map((v, i) => [v.id, preview.rows[i]]));

  const rows = views.map((view): ReviewRow => {
    const base: ReviewRow = {
      id: view.id,
      label: view.fileName,
      status: "ready",
      fields: view.fields,
      errors: {},
      warnings: view.warnings.map((w) => ({ field: w.field, message: w.message })),
      failure: null,
      existingId: null,
      knownUserId: null,
      duplicateAction: view.duplicateAction,
      noEmailForJob: false,
      scored: false,
    };
    if (isInFlight(view)) return { ...base, status: "reading" };
    if (view.status === "failed") return { ...base, status: "failed", failure: resumeErrorMessage(view.errorCode) };
    const p = previewOf.get(view.id)!;
    const status: ReviewStatus =
      kind === "resumes" && withJob && p.status !== "error" && needsEmail(view) ? "needs_email" : p.status;
    return {
      ...base,
      status,
      errors: p.errors,
      // The worker flags a resume whose email is already a candidate's.
      existingId: p.existingId ?? (kind === "resumes" ? view.duplicateOf : null),
      knownUserId: p.knownUserId,
      noEmailForJob: p.noEmailForJob,
      scored: kind === "spreadsheet" ? p.scored : false,
    };
  });

  const counts: Partial<Record<ReviewStatus, number>> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;

  return {
    batch: {
      id: batch.id,
      kind,
      status: batch.status,
      fileName: batch.file_name,
      jobPostId: batch.job_post_id,
      jobTitle: batch.job_postings?.title ?? null,
      expiresAt: batch.expires_at,
      confirmedAt: batch.confirmed_at,
      counts: batch.counts,
      url:
        kind === "resumes"
          ? batch.job_post_id
            ? jobImportPath(batch.job_post_id)
            : candidateImportPath()
          : batch.status === "confirmed"
            ? `${CANDIDATES_LIST_PATH}?batch=${batch.id}`
            : CANDIDATES_LIST_PATH,
    },
    rows,
    counts,
    job: preview.job ? { scored: preview.job.scored, unscored: preview.job.unscored } : null,
    stageValues: kind === "spreadsheet" && withJob ? stageValues(parsed.map((v) => v.fields as MappedRow)) : [],
  };
}

export const confirmStagedSchema = z
  .object({
    batchId: z.string().uuid(),
    /** Null: the talent pool only. */
    jobPostId: z.string().uuid().nullable(),
    stageId: z.string().uuid().optional(),
    stageMap: stageMapSchema.optional(),
    talentListId: z.string().uuid().optional(),
    newListName: z.string().trim().min(1).max(200).optional(),
    duplicateAction: z.enum(DUPLICATE_ACTIONS).default("skip"),
    autoInvite: z.boolean().optional(),
    attested: z.boolean(),
    lawfulBasisNote: z.string().trim().max(200).optional(),
  })
  .strict();

export type ConfirmStagedInput = z.output<typeof confirmStagedSchema>;

/**
 * Confirms a staged spreadsheet (BI-REQ-015/016/017): the rows the review
 * calls ready, already a candidate (with each row's own duplicate action)
 * or already in the pipeline go to `confirmSpreadsheetRows`, which
 * validates them again; rows that still need a fix and later duplicates in
 * the file are left out, as on the import page. Confirming deletes the
 * staged rows. Nobody is emailed.
 */
export async function confirmStagedSpreadsheet(
  auth: ImportSession,
  input: ConfirmStagedInput,
): Promise<ConfirmSpreadsheetResult & { left?: number }> {
  const denied = companyAllows(auth.company, { permission: "applicants.import", jobId: input.jobPostId });
  if (denied) return { ok: false, error: denied };
  if (!input.attested) return { ok: false, error: IMPORT_MESSAGES.not_attested };

  const { data: batch } = await auth.supabase
    .from("candidate_import_batches")
    .select("id, kind, status")
    .eq("id", input.batchId)
    .eq("company_id", auth.company.id)
    .maybeSingle();
  if (!batch || batch.kind !== "spreadsheet") return { ok: false, error: importMessage("not_found") };
  if (batch.status === "confirmed") return { ok: false, error: importMessage("already_confirmed") };

  const { data: rawRows, error } = await auth.supabase
    .from("candidate_import_rows")
    .select(ROW_COLUMNS)
    .eq("batch_id", batch.id)
    .eq("status", "parsed")
    .order("row_number", { ascending: true });
  if (error) throw new Error(`Failed to load the import: ${error.message}`);
  const views = (rawRows ?? []).map(importRowView);
  if (views.length === 0) return { ok: false, error: importMessage("no_rows") };

  const withJob = !!input.jobPostId;
  const fields = views.map((v) => v.fields as MappedRow);
  const emails = fields.flatMap((f) => (typeof f.email === "string" ? [f.email] : []));
  const preview = previewRows(fields, { matches: await matchImportEmails(auth.supabase, auth.company.id, emails), withJob });
  const overrides: Record<number, DuplicateAction> = {};
  views.forEach((v, i) => {
    if (v.duplicateAction) overrides[i] = v.duplicateAction;
  });
  const rows = rowsToConfirm(preview, { overrides, defaultAction: input.duplicateAction });
  if (rows.length === 0) return { ok: false, error: "No row is ready to import. Fix or remove the rows that need it." };

  const result = await confirmSpreadsheetRows(auth, {
    batchId: batch.id,
    rows,
    duplicateAction: input.duplicateAction,
    ...(input.jobPostId ? { jobPostId: input.jobPostId } : {}),
    ...(input.jobPostId && input.stageId ? { stageId: input.stageId } : {}),
    ...(input.jobPostId && input.stageMap ? { stageMap: input.stageMap } : {}),
    ...(input.talentListId ? { talentListId: input.talentListId } : {}),
    ...(input.newListName ? { newListName: input.newListName } : {}),
    ...(input.jobPostId ? { autoInvite: input.autoInvite === true } : {}),
    attested: true,
    ...(input.lawfulBasisNote ? { lawfulBasisNote: input.lawfulBasisNote } : {}),
  });
  if (result.ok) revalidatePath(CANDIDATES_LIST_PATH);
  return result.ok ? { ...result, left: views.length - rows.length } : result;
}
