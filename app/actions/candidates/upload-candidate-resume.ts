"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { toEntitlementActionError, type EntitlementActionError } from "@/helpers/billing/errors";
import { importMessage } from "@/helpers/candidates/copy";
import { attachCandidateResume, candidateResumeFolder } from "@/helpers/candidates/attach-resume";
import type { CandidateResumeWarning } from "@/helpers/candidates/parse-candidate-resume";
import { RESUME_BUCKET, resumeExtensionOf, resumeFileError } from "@/helpers/candidates/resume-files";
import { CANDIDATES_LIST_PATH, candidatePath } from "@/helpers/candidates/paths";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const uploadSchema = z
  .object({
    candidateId: z.string().uuid(),
    file: z
      .object({ name: z.string().trim().min(1).max(255), size: z.number().int().nonnegative(), type: z.string().max(200).optional() })
      .strict(),
  })
  .strict();

const attachSchema = z.object({ candidateId: z.string().uuid(), path: z.string().min(1).max(512) }).strict();

export type CandidateResumeUploadResult = { ok: true; path: string; token: string } | { ok: false; error: string };

export type UploadCandidateResumeResult =
  | { ok: true; warnings: CandidateResumeWarning[]; rescreened: number }
  | { ok: false; error: string }
  | EntitlementActionError;

/**
 * SERVER ACTION (BI-REQ-008), step 1: a signed upload URL for one resume of
 * a candidate the member can see, at <company>/candidates/<candidate>/<uuid>.
 * The path comes from the session company and the checked candidate only.
 */
export async function createCandidateResumeUploadAction(
  input: z.input<typeof uploadSchema>,
): Promise<CandidateResumeUploadResult> {
  const auth = await requireCompanyForAction({ permission: "applicants.import" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: importMessage("invalid") };
  const fileError = resumeFileError(parsed.data.file);
  if (fileError) return { ok: false, error: fileError };

  const { data: candidate } = await auth.supabase
    .from("company_candidates")
    .select("id")
    .eq("id", parsed.data.candidateId)
    .eq("company_id", auth.company.id)
    .maybeSingle();
  if (!candidate) return { ok: false, error: importMessage("not_found") };

  const ext = resumeExtensionOf(parsed.data.file.name);
  const path = `${candidateResumeFolder(auth.company.id, candidate.id)}/${randomUUID()}.${ext}`;
  const { data, error } = await createServiceRoleClient().storage.from(RESUME_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`Failed to sign the upload: ${error?.message ?? "no data"}`);
  return { ok: true, path, token: data.token };
}

/**
 * SERVER ACTION (BI-REQ-008), step 2: reads the uploaded file into the
 * candidate (attach-resume.ts): fills only empty fields, uses one
 * resume_imports unit, deletes a replaced file and screens their open
 * applications again. `set_company_candidate_resume` checks applicants.import
 * (unscoped, or for one of their jobs).
 */
export async function uploadCandidateResumeAction(
  input: z.input<typeof attachSchema>,
): Promise<UploadCandidateResumeResult> {
  const auth = await requireCompanyForAction({ permission: "applicants.import" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = attachSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: importMessage("invalid") };

  const result = await attachCandidateResume({
    supabase: auth.supabase,
    companyId: auth.company.id,
    userId: auth.user.id,
    candidateId: parsed.data.candidateId,
    path: parsed.data.path,
  });
  if (!result.ok) return result.entitlement ? toEntitlementActionError(result.entitlement) : { ok: false, error: result.error };

  revalidatePath(candidatePath(parsed.data.candidateId), "layout");
  revalidatePath(CANDIDATES_LIST_PATH);
  // A talent list's tab shows its candidates too.
  revalidatePath("/company/profiles");
  return { ok: true, warnings: result.warnings, rescreened: result.rescreened };
}
