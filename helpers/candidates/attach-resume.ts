import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/utils/types/database.types";
import { reportError } from "@/helpers/posthog/report-error";
import { assertAllowance, consumeEntitlement } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { extractResumeText, UnreadableFileError } from "@/helpers/resume/extract-text";
import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { requeueScreenings } from "@/helpers/matching/queue-screenings";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { importMessage } from "./copy";
import { parseCandidateResume, RetryableParseError, type CandidateResumeWarning } from "./parse-candidate-resume";
import { RESUME_BUCKET, resumeErrorMessage } from "./resume-files";
import { deleteCandidateFiles } from "./resume-import";

/** Where a candidate's own resume goes: `<company>/candidates/<candidate>/<uuid>.<ext>`. */
export const candidateResumeFolder = (companyId: string, candidateId: string) =>
  `${companyId}/candidates/${candidateId}`;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export const isCandidateResumePath = (path: string, companyId: string, candidateId: string) =>
  new RegExp(`^${candidateResumeFolder(companyId, candidateId)}/${UUID}\\.(pdf|docx)$`).test(path);

export type AttachResumeResult =
  | { ok: true; warnings: CandidateResumeWarning[]; rescreened: number }
  | { ok: false; error: string; entitlement?: EntitlementError };

/**
 * BI-REQ-008: reads an uploaded resume into a candidate. The file is parsed
 * now, with the import's parser; extracted fields only fill empty ones
 * (`set_company_candidate_resume`, which also checks applicants.import for
 * the candidate). One resume_imports unit, charged to the session user once
 * the file was read (ref: the file). A replaced file is deleted. The
 * candidate's open applications are screened again, for free. A file that
 * can't be read or attached is deleted and costs nothing.
 */
export async function attachCandidateResume({
  supabase,
  companyId,
  userId,
  candidateId,
  path,
}: {
  supabase: SupabaseClient<Database>;
  companyId: string;
  userId: string;
  candidateId: string;
  path: string;
}): Promise<AttachResumeResult> {
  if (!isCandidateResumePath(path, companyId, candidateId)) return { ok: false, error: importMessage("invalid") };

  try {
    await assertAllowance(companyId, "resume_imports", 1, userId);
  } catch (err) {
    if (err instanceof EntitlementError) {
      await deleteCandidateFiles([path]);
      return { ok: false, error: err.message, entitlement: err };
    }
    throw err;
  }

  const admin = createServiceRoleClient();
  const { data: file, error: downloadError } = await admin.storage.from(RESUME_BUCKET).download(path);
  if (downloadError || !file) return { ok: false, error: "The upload didn't finish. Try again." };

  let parsed: Awaited<ReturnType<typeof parseCandidateResume>>;
  try {
    const { lines } = await extractResumeText(new Uint8Array(await file.arrayBuffer()));
    parsed = await parseCandidateResume(lines);
  } catch (err) {
    if (!(err instanceof UnreadableFileError) && !(err instanceof RetryableParseError)) throw err;
    await deleteCandidateFiles([path]);
    return {
      ok: false,
      error:
        err instanceof UnreadableFileError
          ? resumeErrorMessage("unreadable")
          : "Couldn't read the resume right now. Try again in a minute.",
    };
  }
  if (!parsed.ok) {
    await deleteCandidateFiles([path]);
    return { ok: false, error: resumeErrorMessage(parsed.reason) };
  }

  const fields: Record<string, unknown> = { ...parsed.fields };
  if (typeof fields.location === "string") [fields.location] = await canonicalizeLocations([fields.location]);

  const { data, error } = await supabase.rpc("set_company_candidate_resume", {
    p_candidate_id: candidateId,
    p_path: path,
    p_content: parsed.resume as unknown as Json,
    p_fields: fields as Json,
  });
  if (error) throw new Error(`Failed to save the resume: ${error.message}`);
  const result = data as { ok: boolean; reason?: string; replaced_path?: string | null; application_ids?: string[] };
  if (!result.ok) {
    await deleteCandidateFiles([path]);
    return { ok: false, error: importMessage(result.reason) };
  }

  try {
    await consumeEntitlement(companyId, "resume_imports", 1, { type: "candidate_resume", id: path }, userId);
  } catch (err) {
    // Checked above; a race with the last unit leaves the resume attached.
    reportError("[candidate resume] couldn't charge the parse", candidateId, err);
  }
  if (result.replaced_path) await deleteCandidateFiles([result.replaced_path]);

  let rescreened = 0;
  const ids = result.application_ids ?? [];
  if (ids.length > 0) {
    const { data: apps } = await admin.from("applications").select("id, job_post_id").in("id", ids);
    try {
      rescreened = await requeueScreenings(admin, { companyId, applications: apps ?? [], requestedBy: userId });
    } catch (err) {
      reportError("[candidate resume] couldn't queue the re-screens", candidateId, err);
    }
  }
  return { ok: true, warnings: parsed.warnings, rescreened };
}
