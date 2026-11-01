import { tool } from "ai";
import { z } from "zod";
import { wrapInSandbox } from "@/helpers/ai/security";
import { AGENT_LIST_DEFAULT_LIMIT } from "@/helpers/agent/config";
import { deleteCandidates, updateCandidate } from "@/helpers/candidates/candidate-writes";
import { confirmResumeBatch } from "@/helpers/candidates/confirm-resume";
import { importCountsOf, type ImportCounts } from "@/helpers/candidates/copy";
import { createCandidate } from "@/helpers/candidates/create-candidate";
import { removeImportRow, retryImportRow, updateImportRow } from "@/helpers/candidates/import-row-writes";
import { listCompanyCandidates } from "@/helpers/candidates/list-candidates";
import { candidatePath, CANDIDATES_LIST_PATH } from "@/helpers/candidates/paths";
import { listMatchingJobs } from "@/helpers/candidates/pool-matches";
import { DUPLICATE_ACTIONS } from "@/helpers/candidates/preview-rows";
import { MAX_RESUME_FILES } from "@/helpers/candidates/resume-files";
import { confirmStagedSpreadsheet, reviewImport, type ReviewRow, type ReviewStatus } from "@/helpers/candidates/staged-import";
import {
  addCompanyCandidateToTalentList,
  createTalentList,
  listTalentLists,
  removeCompanyCandidateFromTalentList,
} from "@/helpers/pipeline/talent-lists";
import type { TResumeRowContent } from "@/utils/types";
import { slugifyListName, talentListPath } from "@/utils/talent-list-tabs";
import { RA_MAX_TALENT_LISTS } from "../config";
import {
  fairnessError,
  limitInput,
  planLimitError,
  type RecruiterToolContext,
  requireToolPermission,
  resumeExcerpt,
  uuidInput,
  withToolErrors,
} from "./shared";

// The company's own candidates and imports (BI-REQ-060): the three ways in
// (resumes, a spreadsheet, one person by hand), reviewing and fixing what
// was read, confirming into the pool, a list or a job, and looking after the
// records afterwards. Everything goes through the same helpers as the
// Candidates and import pages. Candidate text is sandboxed and contact
// details never appear in an output, only whether there is one.

/** Rows getImport returns per call. */
const IMPORT_ROWS_PAGE = 25;
/** Rows one updateImportRows / removeImportRows / retryImportRows call can touch. */
const MAX_ROWS_PER_CALL = 25;
/** Candidates one delete or list call can cover. */
const MAX_CANDIDATES_PER_CALL = 50;
/** Imports listImports returns, newest first. */
const IMPORTS_LISTED = 10;
/** Skills per candidate in a tool output. */
const SKILLS_SHOWN = 15;

/** The statuses getImport lists first: the rows someone has to look at. */
const ATTENTION: ReviewStatus[] = ["error", "needs_email", "failed", "existing", "known", "duplicate_in_file"];

/** A company candidate's own text, sandboxed; null when empty. */
const sandboxed = (tag: string, value: unknown) =>
  typeof value === "string" && value.trim() ? wrapInSandbox(tag, value.trim()) : null;

const listText = (value: unknown, max: number) =>
  Array.isArray(value)
    ? value.slice(0, max).join(", ")
    : typeof value === "string"
      ? value.split(/[,;]/).map((s) => s.trim()).filter(Boolean).slice(0, max).join(", ")
      : "";

const hasText = (value: unknown) => typeof value === "string" && value.trim().length > 0;

/** The import's fields the agent may set. Contact details are input only; they never come back out. */
const fieldInputs = {
  full_name: z.string().trim().min(1).max(120).describe("Full name."),
  email: z.string().trim().max(254).describe("Email, only one the user gave you."),
  phone: z.string().trim().max(30).describe("Phone, only one the user gave you."),
  location: z.string().trim().max(120),
  current_title: z.string().trim().max(120),
  current_company: z.string().trim().max(120),
  experience_years: z.number().min(0).max(60),
  linkedin_url: z.string().trim().max(2048),
  github_url: z.string().trim().max(2048),
  portfolio_url: z.string().trim().max(2048),
  skills: z.array(z.string().trim().min(1).max(60)).max(50),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  notes: z.string().trim().max(2000),
};

/** Any subset of the fields; null clears one. */
const fieldChanges = z
  .object(Object.fromEntries(Object.entries(fieldInputs).map(([k, s]) => [k, s.nullable().optional()])) as {
    [K in keyof typeof fieldInputs]: z.ZodOptional<z.ZodNullable<(typeof fieldInputs)[K]>>;
  })
  .strict();

const duplicateActionInput = z
  .enum(DUPLICATE_ACTIONS)
  .describe("For someone who's already one of the company's candidates: skip (keep their record), fill (only empty fields) or overwrite.");

/** Tags and notes never name a protected characteristic (RA-SEC-004). */
const fieldsFairnessError = (fields: { tags?: string[] | null; notes?: string | null }) =>
  fairnessError([...(fields.tags ?? []), fields.notes ?? null]);

/** The fields the schema accepts, with undefined dropped. */
const definedFields = (fields: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));

/** One review row for the model: sandboxed text, no contact details. */
function rowOutput(row: ReviewRow) {
  const f = row.fields;
  return {
    rowId: row.id,
    row: wrapInSandbox("import_row_label", row.label),
    status: row.status,
    name: sandboxed("candidate_name", f.full_name),
    title: sandboxed("candidate_title", f.current_title),
    company: sandboxed("candidate_company", f.current_company),
    location: sandboxed("candidate_location", f.location),
    experienceYears: typeof f.experience_years === "number" ? f.experience_years : (f.experience_years ?? null),
    skills: sandboxed("candidate_skills", listText(f.skills, SKILLS_SHOWN)),
    hasEmail: hasText(f.email),
    hasPhone: hasText(f.phone),
    ...(Object.keys(row.errors).length > 0 ? { errors: row.errors } : {}),
    ...(row.warnings.length > 0 ? { warnings: row.warnings } : {}),
    ...(row.failure ? { failure: row.failure } : {}),
    ...(row.existingId ? { alreadyCandidateUrl: candidatePath(row.existingId) } : {}),
    ...(row.knownUserId ? { gethiredProfileUrl: `/company/profiles/${row.knownUserId}` } : {}),
    ...(row.duplicateAction ? { duplicateAction: row.duplicateAction } : {}),
    ...(row.noEmailForJob ? { notAddedToJob: "No email: imported as a candidate, but not added to the job." } : {}),
  };
}

/** The confirm's counts as one line, for the model to repeat. */
function describeCounts(counts: ImportCounts): string {
  const parts = [
    counts.created && `${counts.created} new candidates`,
    counts.updated && `${counts.updated} existing candidates updated`,
    counts.skipped && `${counts.skipped} existing candidates left as they were`,
    counts.known && `${counts.known} already on GetHired and in your pipeline`,
    counts.added_to_job && `${counts.added_to_job} added to the job`,
    counts.already_in_job && `${counts.already_in_job} already in the job`,
    counts.needs_outreach && `${counts.needs_outreach} on GetHired who haven't applied (reach them through outreach)`,
    counts.no_email && `${counts.no_email} not added to the job for lack of an email`,
    counts.added_to_list && `${counts.added_to_list} added to the list`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Nothing changed.";
}

export function createImportTools(ctx: RecruiterToolContext) {
  const { supabase, company } = ctx;

  return {
    requestResumeImport: tool({
      description: `Ask the user to upload resumes (PDF or Word, up to ${MAX_RESUME_FILES} at a time). The app shows an upload widget in the chat; the files are read in the background, each using one resume import from the plan. With jobPostId they're for that job, otherwise for the company's candidates. The result is the import's batchId (then call getImport), or cancelled. Nothing is imported until confirmImport.`,
      inputSchema: z.object({
        jobPostId: uuidInput("job post").optional(),
        reason: z.string().max(200).optional().describe("Short line shown above the widget."),
      }),
      outputSchema: z.object({ batchId: z.string().optional(), files: z.number().optional(), cancelled: z.boolean().optional() }),
    }),

    requestSpreadsheetImport: tool({
      description:
        "Ask the user to upload a CSV or XLSX of people (up to 5,000). The app shows a widget in the chat where the user matches the columns; the rows are then saved for review. Pass jobPostId when they're going into a job, so a Stage column can be used. The result is the import's batchId (then call getImport), or cancelled. Nothing is imported until confirmImport.",
      inputSchema: z.object({
        jobPostId: uuidInput("job post").optional(),
        reason: z.string().max(200).optional().describe("Short line shown above the widget."),
      }),
      outputSchema: z.object({ batchId: z.string().optional(), rows: z.number().optional(), cancelled: z.boolean().optional() }),
    }),

    requestCandidateResume: tool({
      description:
        "Ask the user to upload one resume for one of the company's candidates (from listMyCandidates or getMyCandidate). It fills only the details that are empty, uses one resume import, and screens their open applications again. The result is uploaded or cancelled.",
      inputSchema: z.object({
        candidateId: uuidInput("company candidate"),
        reason: z.string().max(200).optional().describe("Short line shown above the widget."),
      }),
      outputSchema: z.object({ uploaded: z.boolean().optional(), rescreened: z.number().optional(), cancelled: z.boolean().optional() }),
    }),

    listImports: tool({
      description:
        "List the company's recent spreadsheet and resume imports, newest first: what each was, its job, whether it's being read, waiting for review, confirmed (with its counts) or expired. Imports that aren't confirmed are deleted 7 days after they started.",
      inputSchema: z.object({}),
      execute: () =>
        withToolErrors(ctx, "listImports", async () => {
          const { data, error } = await supabase
            .from("candidate_import_batches")
            .select("id, kind, status, file_name, job_post_id, created_at, expires_at, confirmed_at, counts, job_postings(title)")
            .eq("company_id", company.id)
            // Hand-added candidates are one-row batches with no file.
            .not("file_name", "is", null)
            .order("created_at", { ascending: false })
            .limit(IMPORTS_LISTED);
          if (error) throw new Error(`Failed to load the imports: ${error.message}`);
          return {
            imports: (data ?? []).map((b) => ({
              batchId: b.id,
              kind: b.kind,
              status: b.status,
              file: wrapInSandbox("import_file_name", b.file_name ?? ""),
              job: b.job_post_id ? { id: b.job_post_id, title: b.job_postings?.title ?? null } : null,
              startedAt: b.created_at,
              ...(b.status === "confirmed"
                ? { confirmedAt: b.confirmed_at, result: describeCounts(importCountsOf(b.counts)) }
                : { expiresAt: b.expires_at }),
            })),
          };
        }),
    }),

    getImport: tool({
      description: `Review one import (a batchId from requestResumeImport, requestSpreadsheetImport or listImports): its status, the rows per status and ${IMPORT_ROWS_PAGE} rows at a time, the ones that need attention first. Statuses: ready; error (fields that need a fix, with the messages); needs_email (a resume going into a job without an email); failed (a resume that couldn't be read); existing (already one of the company's candidates); known (already on GetHired and in the pipeline: never imported, linked instead); duplicate_in_file (a repeat of an earlier row, skipped); reading (not read yet). Never includes contact details, only whether there is an email or phone. For a spreadsheet going into a job, stageValues lists the Stage column's values for confirmImport's stageMap.`,
      inputSchema: z.object({
        batchId: uuidInput("import"),
        show: z.enum(["attention", "all"]).optional().describe("attention (default): only rows someone has to look at."),
        offset: z.number().int().min(0).optional(),
      }),
      execute: ({ batchId, show, offset }) =>
        withToolErrors(ctx, "getImport", async () => {
          const review = await reviewImport(ctx, batchId);
          if (!review) return { error: "Import not found." };
          const { batch } = review;
          const listed = show === "all" ? review.rows : review.rows.filter((r) => ATTENTION.includes(r.status));
          const start = offset ?? 0;
          const page = listed.slice(start, start + IMPORT_ROWS_PAGE);
          const reading = review.counts.reading ?? 0;
          return {
            import: {
              batchId: batch.id,
              kind: batch.kind,
              status: batch.status,
              file: wrapInSandbox("import_file_name", batch.fileName ?? ""),
              job: batch.jobPostId ? { id: batch.jobPostId, title: batch.jobTitle } : null,
              url: batch.url,
              ...(batch.status === "confirmed"
                ? { result: describeCounts(importCountsOf(batch.counts)) }
                : { expiresAt: batch.expiresAt }),
            },
            rowCounts: review.counts,
            ...(review.job
              ? {
                  screening: {
                    willBeScored: review.job.scored,
                    notScoredUntilResume: review.job.unscored,
                    note: "Each scored application uses one screening from the plan.",
                  },
                }
              : {}),
            ...(review.stageValues.length > 0
              ? { stageValues: wrapInSandbox("stage_values", review.stageValues.join("\n")) }
              : {}),
            rows: page.map(rowOutput),
            nextOffset: start + IMPORT_ROWS_PAGE < listed.length ? start + IMPORT_ROWS_PAGE : null,
            ...(reading > 0 ? { note: `${reading} still being read. Check again in a minute.` } : {}),
          };
        }),
    }),

    updateImportRows: tool({
      description: `Fix up to ${MAX_ROWS_PER_CALL} rows of an import before it's confirmed (row ids from getImport): any of the fields (null clears one), and what to do when the person is already one of the company's candidates. Use only details the user gave you or that are in the row; never guess an email.`,
      inputSchema: z.object({
        rows: z
          .array(
            z
              .object({
                rowId: uuidInput("import row"),
                fields: fieldChanges.optional(),
                duplicateAction: duplicateActionInput.optional(),
              })
              .strict(),
          )
          .min(1)
          .max(MAX_ROWS_PER_CALL),
      }),
      execute: ({ rows }) =>
        withToolErrors(ctx, "updateImportRows", async () => {
          const results = [];
          for (const row of rows) {
            const unfair = row.fields ? fieldsFairnessError(row.fields) : null;
            if (unfair) {
              results.push({ rowId: row.rowId, ...unfair });
              continue;
            }
            const result = await updateImportRow(ctx, {
              rowId: row.rowId,
              ...(row.fields ? { fields: definedFields(row.fields) } : {}),
              ...(row.duplicateAction ? { duplicateAction: row.duplicateAction } : {}),
            });
            results.push(
              result.ok
                ? { rowId: row.rowId, saved: true }
                : { rowId: row.rowId, error: result.error, ...(result.errors ? { fieldErrors: result.errors } : {}) },
            );
          }
          return { rows: results };
        }),
    }),

    removeImportRows: tool({
      description: `Take up to ${MAX_ROWS_PER_CALL} rows out of an import before it's confirmed (row ids from getImport), only when the user asks. A resume's file is deleted, and one that wasn't read yet gives its resume import back.`,
      inputSchema: z.object({ rowIds: z.array(uuidInput("import row")).min(1).max(MAX_ROWS_PER_CALL) }),
      execute: ({ rowIds }) =>
        withToolErrors(ctx, "removeImportRows", async () => {
          const results = [];
          for (const rowId of rowIds) {
            const result = await removeImportRow(ctx, rowId);
            results.push(result.ok ? { rowId, removed: true } : { rowId, error: result.error });
          }
          return { rows: results };
        }),
    }),

    retryImportRows: tool({
      description: `Read up to ${MAX_ROWS_PER_CALL} failed resumes again (row ids from getImport with status failed). Each retry uses another resume import from the plan. A scanned resume with no text will fail again.`,
      inputSchema: z.object({ rowIds: z.array(uuidInput("import row")).min(1).max(MAX_ROWS_PER_CALL) }),
      execute: ({ rowIds }) =>
        withToolErrors(ctx, "retryImportRows", async () => {
          const results = [];
          for (const rowId of rowIds) {
            const result = await retryImportRow(ctx, rowId);
            if ("ok" in result) {
              results.push(result.ok ? { rowId, queued: true } : { rowId, error: result.error });
              continue;
            }
            // Out of resume imports: the rest would fail the same way.
            return { rows: results, ...planLimitError(result.error) };
          }
          return { rows: results };
        }),
    }),

    confirmImport: tool({
      description:
        "Import a reviewed spreadsheet or resume batch (batchId from getImport) into the company's candidates, and optionally a talent list and/or a job at a stage (ids from listMyJobs, listStages and listTalentLists; newListName creates a list). Rows that still need a fix, failed or are still being read are left out; for a job, every resume needs an email first. Nobody is emailed. With autoInvite, people who score at or above the job's AI interview threshold are invited to it. The user's approval records that the company has a lawful basis to process these people's data; pass the basis they named, if any, as lawfulBasisNote.",
      inputSchema: z.object({
        batchId: uuidInput("import"),
        jobPostId: uuidInput("job post").nullable().describe("The job to add them to, or null for the company's candidates only."),
        stageId: uuidInput("pipeline stage").optional().describe("The job's stage; default the first stage."),
        stageMap: z
          .record(z.string().max(120), z.string().uuid())
          .optional()
          .describe("Spreadsheets with a Stage column: each of getImport's stageValues → a stage id. Values left out go to stageId."),
        talentListId: uuidInput("talent list").optional(),
        newListName: z.string().trim().min(1).max(60).optional(),
        duplicateAction: duplicateActionInput.optional(),
        autoInvite: z.boolean().optional(),
        lawfulBasisNote: z.string().trim().max(200).optional().describe("e.g. 'applied by email', 'referral'."),
      }),
      execute: (input) =>
        withToolErrors(ctx, "confirmImport", async () => {
          if (input.talentListId && input.newListName) return { error: "Choose an existing list or a new one, not both." };
          if (input.talentListId || input.newListName) {
            const denied = requireToolPermission(ctx, "talent_lists.manage");
            if (denied) return denied;
          }
          const { data: batch } = await supabase
            .from("candidate_import_batches")
            .select("id, kind")
            .eq("id", input.batchId)
            .eq("company_id", company.id)
            .maybeSingle();
          if (!batch) return { error: "Import not found." };

          const common = {
            batchId: batch.id,
            ...(input.talentListId ? { talentListId: input.talentListId } : {}),
            ...(input.newListName ? { newListName: input.newListName } : {}),
            duplicateAction: input.duplicateAction ?? "skip",
            ...(input.jobPostId ? { autoInvite: input.autoInvite === true } : {}),
            attested: true,
            ...(input.lawfulBasisNote ? { lawfulBasisNote: input.lawfulBasisNote } : {}),
          };
          const result =
            batch.kind === "resumes"
              ? await confirmResumeBatch(ctx, {
                  ...common,
                  jobPostId: input.jobPostId,
                  stageId: input.jobPostId ? (input.stageId ?? null) : null,
                })
              : await confirmStagedSpreadsheet(ctx, {
                  ...common,
                  jobPostId: input.jobPostId,
                  ...(input.jobPostId && input.stageId ? { stageId: input.stageId } : {}),
                  ...(input.jobPostId && input.stageMap ? { stageMap: input.stageMap } : {}),
                });
          if (!result.ok) {
            return { error: result.error, ...("rowIds" in result && result.rowIds ? { rowIds: result.rowIds } : {}) };
          }
          return {
            confirmed: true,
            counts: result.counts,
            summary: describeCounts(result.counts),
            candidatesUrl: `${CANDIDATES_LIST_PATH}?batch=${batch.id}`,
            ...(input.jobPostId ? { applicationsUrl: `/company/job-posts/${input.jobPostId}/applications` } : {}),
            ...("left" in result && result.left ? { leftOut: result.left } : {}),
          };
        }),
    }),

    addCandidate: tool({
      description:
        "Add one person to the company's candidates by hand (a referral, someone who emailed a resume), optionally into a talent list and/or a job at a stage. Use only details the user gave you; never guess an email or phone. A job needs their email. Nobody is emailed. requestCandidateResume can add their resume afterwards. The user's approval records that the company has a lawful basis to process this person's data; pass the basis they named, if any, as lawfulBasisNote.",
      inputSchema: z
        .object({
          ...fieldInputs,
          email: fieldInputs.email.optional(),
          phone: fieldInputs.phone.optional(),
          location: fieldInputs.location.optional(),
          current_title: fieldInputs.current_title.optional(),
          current_company: fieldInputs.current_company.optional(),
          experience_years: fieldInputs.experience_years.optional(),
          linkedin_url: fieldInputs.linkedin_url.optional(),
          github_url: fieldInputs.github_url.optional(),
          portfolio_url: fieldInputs.portfolio_url.optional(),
          skills: fieldInputs.skills.optional(),
          tags: fieldInputs.tags.optional(),
          notes: fieldInputs.notes.optional(),
          jobPostId: uuidInput("job post").optional(),
          stageId: uuidInput("pipeline stage").optional(),
          talentListId: uuidInput("talent list").optional(),
          newListName: z.string().trim().min(1).max(60).optional(),
          lawfulBasisNote: z.string().trim().max(200).optional().describe("e.g. 'referral', 'applied by email'."),
        })
        .strict(),
      execute: ({ jobPostId, stageId, talentListId, newListName, lawfulBasisNote, ...fields }) =>
        withToolErrors(ctx, "addCandidate", async () => {
          const unfair = fieldsFairnessError(fields);
          if (unfair) return unfair;
          const result = await createCandidate(ctx, {
            ...definedFields(fields),
            ...(jobPostId ? { jobPostId } : {}),
            ...(jobPostId && stageId ? { stageId } : {}),
            ...(talentListId ? { talentListId } : {}),
            ...(newListName ? { newListName } : {}),
            attested: true,
            ...(lawfulBasisNote ? { lawfulBasisNote } : {}),
          });
          if (!result.ok) {
            return {
              error: result.error,
              ...(result.errors ? { fieldErrors: result.errors } : {}),
              ...(result.existing ? { existingUrl: result.existing.href } : {}),
            };
          }
          return {
            candidateId: result.candidateId,
            url: candidatePath(result.candidateId),
            ...(jobPostId ? { addedToJob: result.addedToJob } : {}),
          };
        }),
    }),

    listMyCandidates: tool({
      description:
        "List the company's own candidates (people it imported or added, who aren't on GetHired), newest first, 25 a page. Filters: q (name, title, company or skills), tag, batchId (one import), inJob, hasResume, hasEmail, addedDays. Never includes contact details. For matching to a job, use findPoolCandidates.",
      inputSchema: z.object({
        q: z.string().trim().max(100).optional(),
        tag: z.string().trim().max(40).optional(),
        batchId: uuidInput("import").optional(),
        inJob: z.boolean().optional().describe("true: in at least one job; false: in none."),
        hasResume: z.boolean().optional(),
        hasEmail: z.boolean().optional(),
        addedDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
        page: z.number().int().min(1).optional(),
      }),
      execute: (input) =>
        withToolErrors(ctx, "listMyCandidates", async () => {
          const unfair = fairnessError([input.q, input.tag]);
          if (unfair) return unfair;
          const list = await listCompanyCandidates(supabase, company.id, {
            q: input.q ?? null,
            tag: input.tag ?? null,
            batchId: input.batchId ?? null,
            inJob: input.inJob === undefined ? null : input.inJob ? "yes" : "no",
            loc: null,
            resume: input.hasResume === undefined ? null : input.hasResume ? "has" : "none",
            email: input.hasEmail === undefined ? null : input.hasEmail ? "has" : "none",
            addedDays: input.addedDays ?? null,
            matchJob: null,
            page: input.page ?? 1,
          });
          return {
            total: list.total,
            page: list.page,
            pages: Math.max(1, Math.ceil(list.total / list.pageSize)),
            candidates: list.items.map((c) => ({
              candidateId: c.id,
              name: wrapInSandbox("candidate_name", c.name.trim() || "Candidate"),
              title: sandboxed("candidate_title", c.title),
              location: sandboxed("candidate_location", c.location),
              tags: c.tags.length > 0 ? wrapInSandbox("candidate_tags", c.tags.join(", ")) : null,
              hasEmail: !!c.email,
              jobs: c.jobCount,
              addedAt: c.createdAt,
              url: candidatePath(c.id),
            })),
          };
        }),
    }),

    getMyCandidate: tool({
      description:
        "Read one of the company's own candidates: their profile, resume excerpt, tags and notes, the jobs they're in with the stage, and whether they have an email, unsubscribed or connected a GetHired account. Never includes contact details.",
      inputSchema: z.object({ candidateId: uuidInput("company candidate") }),
      execute: ({ candidateId }) =>
        withToolErrors(ctx, "getMyCandidate", async () => {
          const [{ data: row, error }, { data: apps, error: appsError }] = await Promise.all([
            supabase
              .from("company_candidates")
              .select(
                "id, full_name, email, phone, location, current_title, current_company, experience_years, skills, tags, notes, resume_content, email_opted_out_at, claimed_user_id, created_at, candidate_import_batches!company_candidates_source_batch_id_fkey(file_name)",
              )
              .eq("id", candidateId)
              .eq("company_id", company.id)
              .maybeSingle(),
            supabase
              .from("applications")
              .select("id, job_postings(id, title), pipeline_stages(name)")
              .eq("company_candidate_id", candidateId)
              .is("merged_into_application_id", null)
              .order("created_at", { ascending: false }),
          ]);
          if (error) throw new Error(`Failed to load the candidate: ${error.message}`);
          if (appsError) throw new Error(`Failed to load the candidate's applications: ${appsError.message}`);
          if (!row) return { error: "Candidate not found." };
          return {
            candidateId: row.id,
            name: wrapInSandbox("candidate_name", row.full_name),
            title: sandboxed("candidate_title", row.current_title),
            company: sandboxed("candidate_company", row.current_company),
            location: sandboxed("candidate_location", row.location),
            experienceYears: row.experience_years,
            skills: row.skills.length > 0 ? wrapInSandbox("candidate_skills", row.skills.slice(0, SKILLS_SHOWN).join(", ")) : null,
            tags: row.tags.length > 0 ? wrapInSandbox("candidate_tags", row.tags.join(", ")) : null,
            notes: sandboxed("candidate_note", row.notes),
            resume: resumeExcerpt(row.resume_content as TResumeRowContent | null),
            hasResume: !!row.resume_content,
            hasEmail: !!row.email,
            hasPhone: !!row.phone,
            unsubscribed: !!row.email_opted_out_at,
            gethiredAccountConnected: !!row.claimed_user_id,
            importedFrom: row.candidate_import_batches?.file_name
              ? wrapInSandbox("import_file_name", row.candidate_import_batches.file_name)
              : "Added by hand",
            addedAt: row.created_at,
            applications: (apps ?? []).flatMap((a) =>
              a.job_postings
                ? [
                    {
                      applicationId: a.id,
                      job: { id: a.job_postings.id, title: a.job_postings.title },
                      stage: a.pipeline_stages?.name ?? null,
                      url: `/company/applications/${a.id}`,
                    },
                  ]
                : [],
            ),
            url: candidatePath(row.id),
          };
        }),
    }),

    findJobsForMyCandidate: tool({
      description:
        "The company's active jobs closest to one of its own candidates' profile, best first, with a similarity from 0 to 100. Similarity compares the profile with each job's text: it isn't a fit score or a recommendation.",
      inputSchema: z.object({ candidateId: uuidInput("company candidate"), limit: limitInput }),
      execute: ({ candidateId, limit }) =>
        withToolErrors(ctx, "findJobsForMyCandidate", async () => {
          // talent.view is checked before the call; the jobs need jobs.view too (CP-REQ-063).
          const denied = requireToolPermission(ctx, "jobs.view");
          if (denied) return denied;
          const result = await listMatchingJobs(supabase, candidateId);
          if (!result.ok) return { error: result.error };
          if (result.status === "not_embedded") {
            return { status: "not_ready", message: "Their profile is still being read. Try again in a minute." };
          }
          return {
            jobs: result.matches.slice(0, limit ?? AGENT_LIST_DEFAULT_LIMIT).map((m) => ({
              jobPostId: m.jobId,
              title: m.title,
              similarity: m.score,
            })),
          };
        }),
    }),

    updateMyCandidate: tool({
      description:
        "Change details of one of the company's own candidates (null clears a field). Use only details the user gave you; never guess an email or phone. Tags and notes are replaced, not added to: read getMyCandidate first. It can't add or replace their resume: use requestCandidateResume for that.",
      inputSchema: z.object({ candidateId: uuidInput("company candidate"), fields: fieldChanges }),
      execute: ({ candidateId, fields }) =>
        withToolErrors(ctx, "updateMyCandidate", async () => {
          const unfair = fieldsFairnessError(fields);
          if (unfair) return unfair;
          const changes = definedFields(fields);
          // full_name can't be cleared.
          if (changes.full_name === null) return { error: "A candidate needs a name." };
          const result = await updateCandidate(ctx, candidateId, changes);
          if (!result.ok) return { error: result.error, ...(result.errors ? { fieldErrors: result.errors } : {}) };
          return { candidateId, saved: true, url: candidatePath(candidateId) };
        }),
    }),

    deleteMyCandidates: tool({
      description: `Permanently delete up to ${MAX_CANDIDATES_PER_CALL} of the company's own candidates, only when the user asks: their imported applications, list memberships and resume files go too. Someone who connected a GetHired account keeps their own applications.`,
      inputSchema: z.object({ candidateIds: z.array(uuidInput("company candidate")).min(1).max(MAX_CANDIDATES_PER_CALL) }),
      execute: ({ candidateIds }) =>
        withToolErrors(ctx, "deleteMyCandidates", async () => {
          // A candidate can be in jobs the user isn't on (BI-PERM-002).
          const denied = requireToolPermission(ctx, "applicants.import", null);
          if (denied) return denied;
          const result = await deleteCandidates(ctx, [...new Set(candidateIds)]);
          if (!result.ok) return { error: result.error };
          return { deleted: result.deleted };
        }),
    }),

    addMyCandidatesToList: tool({
      description: `Add up to ${MAX_CANDIDATES_PER_CALL} of the company's own candidates to a named talent list, creating the list if it doesn't exist (up to ${RA_MAX_TALENT_LISTS} lists). Adding someone twice does nothing. For GetHired candidates, use addToTalentList.`,
      inputSchema: z.object({
        candidateIds: z.array(uuidInput("company candidate")).min(1).max(MAX_CANDIDATES_PER_CALL),
        listName: z.string().trim().min(1).max(60),
      }),
      execute: ({ candidateIds, listName }) =>
        withToolErrors(ctx, "addMyCandidatesToList", async () => {
          const lists = await listTalentLists(ctx);
          const slug = slugifyListName(listName);
          let list = lists.find((l) => l.slug === slug);
          let created = false;
          if (!list) {
            if (lists.length >= RA_MAX_TALENT_LISTS) {
              return {
                error: `The company already has ${RA_MAX_TALENT_LISTS} talent lists. Use an existing one: ${lists.map((l) => l.name).join(", ")}.`,
              };
            }
            const result = await createTalentList(ctx, listName);
            if (!result.ok) return { error: result.error };
            list = { ...result.list, memberCount: 0, hasCandidate: false };
            created = true;
          }
          let added = 0;
          const failed: { candidateId: string; error: string }[] = [];
          for (const candidateId of [...new Set(candidateIds)]) {
            const result = await addCompanyCandidateToTalentList(ctx, list.id, candidateId);
            if (result.ok) added++;
            else failed.push({ candidateId, error: result.error });
          }
          return {
            list: { id: list.id, name: list.name },
            created,
            added,
            ...(failed.length > 0 ? { failed } : {}),
            url: talentListPath(list.slug),
          };
        }),
    }),

    removeMyCandidateFromList: tool({
      description:
        "Take one of the company's own candidates off a talent list (ids from listTalentLists). They stay in the company's candidates and on its other lists.",
      inputSchema: z.object({ listId: uuidInput("talent list"), candidateId: uuidInput("company candidate") }),
      execute: ({ listId, candidateId }) =>
        withToolErrors(ctx, "removeMyCandidateFromList", async () => {
          const result = await removeCompanyCandidateFromTalentList(ctx, listId, candidateId);
          if (!result.ok) return { error: result.error };
          return { listId, candidateId, removed: true };
        }),
    }),
  };
}
