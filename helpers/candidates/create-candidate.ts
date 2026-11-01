import { revalidatePath } from "next/cache";
import { z } from "zod";
import { companyAllows } from "@/helpers/companies/require-company";
import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { createTalentList, deleteTalentList } from "@/helpers/pipeline/talent-lists";
import { parseCandidateFields, type CandidateFieldErrors } from "./candidate-schema";
import { IMPORT_MESSAGES, importCountsOf, importMessage } from "./copy";
import { findExistingPerson, type ExistingPerson } from "./existing-person";
import type { ImportSession } from "./import-session";
import { CANDIDATES_LIST_PATH } from "./paths";

/** What the form sends besides the candidate's fields. */
const metaSchema = z
  .object({
    jobPostId: z.string().uuid().optional(),
    stageId: z.string().uuid().optional(),
    talentListId: z.string().uuid().optional(),
    newListName: z.string().trim().min(1).max(200).optional(),
    attested: z.boolean(),
    lawfulBasisNote: z.string().trim().max(200).optional(),
  })
  .strict();

export type CreateCandidateInput = z.input<typeof metaSchema> & Record<string, unknown>;

export type CreateCandidateResult =
  | { ok: true; candidateId: string; addedToJob: boolean }
  | { ok: false; error: string; errors?: CandidateFieldErrors; existing?: ExistingPerson };

const META_KEYS = new Set(Object.keys(metaSchema.shape));

/**
 * BI-REQ-009, CP-REQ-001/003: adds one candidate by hand, to the pool, a
 * talent list (which it can create, with talent_lists.manage) and/or a job
 * and stage. It's a one-row spreadsheet batch: `start_candidate_import` then
 * `confirm_candidate_import`, which apply the same rules as a file
 * (BI-REQ-016's attestation, the 60-an-hour limit). An email that's already a
 * candidate or a GetHired user is refused with a link to them. Nobody is
 * emailed. Shared by `createCandidateAction` and the agent's `addCandidate`;
 * the caller has checked applicants.import at some scope.
 */
export async function createCandidate(auth: ImportSession, input: CreateCandidateInput): Promise<CreateCandidateResult> {
  const raw: Record<string, unknown> = input && typeof input === "object" ? input : {};
  const pick = (meta: boolean) => Object.fromEntries(Object.entries(raw).filter(([k]) => META_KEYS.has(k) === meta));
  const meta = metaSchema.safeParse(pick(true));
  if (!meta.success) return { ok: false, error: IMPORT_MESSAGES.invalid };
  const { jobPostId, stageId, talentListId, newListName, attested, lawfulBasisNote } = meta.data;

  // BI-PERM-001: for the job, or unscoped without one; a list also needs talent_lists.manage.
  const denied = companyAllows(auth.company, { permission: "applicants.import", jobId: jobPostId ?? null });
  if (denied) return { ok: false, error: denied };
  if (talentListId && newListName) return { ok: false, error: IMPORT_MESSAGES.invalid };
  if (talentListId || newListName) {
    const listDenied = companyAllows(auth.company, { permission: "talent_lists.manage" });
    if (listDenied) return { ok: false, error: listDenied };
  }
  if (!attested) return { ok: false, error: IMPORT_MESSAGES.not_attested };

  const parsed = parseCandidateFields(pick(false));
  if (!parsed.ok) return { ok: false, error: "Fix the highlighted fields.", errors: parsed.errors };
  const fields = parsed.data;
  if (jobPostId && !fields.email) {
    return { ok: false, error: IMPORT_MESSAGES.no_email, errors: { email: IMPORT_MESSAGES.no_email } };
  }
  if (fields.location) [fields.location] = await canonicalizeLocations([fields.location]);

  if (fields.email) {
    const existing = await findExistingPerson(auth.supabase, auth.company.id, fields.email);
    if (existing) {
      return {
        ok: false,
        error: existing.kind === "candidate" ? IMPORT_MESSAGES.duplicate_email : IMPORT_MESSAGES.known_user,
        existing,
      };
    }
  }

  // No file name: a hand-added candidate (its own rate limit).
  const { data: started, error: startError } = await auth.supabase.rpc("start_candidate_import", {
    p_kind: "spreadsheet",
  });
  if (startError) throw new Error(`Failed to start the import: ${startError.message}`);
  const start = started as { ok: boolean; reason?: string; batch_id?: string };
  if (!start.ok || !start.batch_id) return { ok: false, error: importMessage(start.reason) };

  let listId = talentListId;
  let newList: { id: string } | null = null;
  if (newListName) {
    const created = await createTalentList(auth, newListName);
    if (!created.ok) return { ok: false, error: created.error };
    newList = created.list;
    listId = created.list.id;
  }
  // A list made for this candidate goes again if they aren't added.
  const dropNewList = async () => {
    if (newList) await deleteTalentList(auth, newList.id).catch(() => {});
  };

  const { data: confirmed, error: confirmError } = await auth.supabase.rpc("confirm_candidate_import", {
    p_batch_id: start.batch_id,
    p_rows: [fields],
    p_options: {
      attested: true,
      ...(lawfulBasisNote ? { lawful_basis_note: lawfulBasisNote } : {}),
      duplicate_action: "skip",
      ...(listId ? { talent_list_id: listId } : {}),
      ...(jobPostId ? { job_post_id: jobPostId, ...(stageId ? { stage_id: stageId } : {}) } : {}),
    },
  });
  if (confirmError) {
    await dropNewList();
    throw new Error(`Failed to add the candidate: ${confirmError.message}`);
  }
  const result = confirmed as { ok: boolean; reason?: string; counts?: unknown; candidate_ids?: string[] };
  const candidateId = result.candidate_ids?.[0];
  if (!result.ok || !candidateId) {
    await dropNewList();
    return { ok: false, error: importMessage(result.reason) };
  }

  revalidatePath(CANDIDATES_LIST_PATH);
  // A talent list's tab shows its candidates too.
  revalidatePath("/company/profiles");
  if (jobPostId) {
    revalidatePath(`/company/job-posts/${jobPostId}`);
    revalidatePath(`/company/job-posts/${jobPostId}/applications`);
  }
  return { ok: true, candidateId, addedToJob: !!jobPostId && importCountsOf(result.counts).added_to_job > 0 };
}
