import "server-only";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/utils/types/database.types";
import { candidateResumeFolder } from "@/helpers/candidates/attach-resume";
import { parseCandidateResume } from "@/helpers/candidates/parse-candidate-resume";
import { MAX_RESUME_BYTES, RESUME_BUCKET, RESUME_MIME_TYPES } from "@/helpers/candidates/resume-files";
import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { requeueScreenings } from "@/helpers/matching/queue-screenings";
import { reportError } from "@/helpers/posthog/report-error";
import { extractResumeText, sniffFileType } from "@/helpers/resume/extract-text";

export type StoreBoardResumeResult = "attached" | "skipped" | "has_resume" | "failed";

/**
 * MPT-031: the resume a board sent with an application, run after the
 * webhook has replied. The file is checked by its bytes (PDF or DOCX, at
 * most 10 MB), stored under the candidate's folder and parsed with the
 * import's parser; parsed fields only fill empty ones. A candidate who
 * already has a resume keeps it. If parsing fails the file is still
 * attached, unparsed, so the company can open it. The candidate's open
 * applications are screened again with the resume. No allowance is charged:
 * nobody at the company started this (MP-OPEN-008 decides plan limits).
 */
export async function storeBoardResume(
  admin: SupabaseClient<Database>,
  { companyId, candidateId, base64 }: { companyId: string; candidateId: string; base64: string },
): Promise<StoreBoardResumeResult> {
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  if (bytes.length === 0 || bytes.length > MAX_RESUME_BYTES) return "skipped";
  const type = sniffFileType(bytes);
  if (!type) return "skipped";

  const path = `${candidateResumeFolder(companyId, candidateId)}/${randomUUID()}.${type}`;
  const upload = await admin.storage.from(RESUME_BUCKET).upload(path, bytes, { contentType: RESUME_MIME_TYPES[type] });
  if (upload.error) {
    reportError("[board resume] upload failed", candidateId, upload.error.message);
    return "failed";
  }

  let content: Json | null = null;
  let fields: Record<string, unknown> = {};
  try {
    const { lines } = await extractResumeText(bytes);
    const parsed = await parseCandidateResume(lines);
    if (parsed.ok) {
      content = parsed.resume as unknown as Json;
      fields = { ...parsed.fields };
      if (typeof fields.location === "string") [fields.location] = await canonicalizeLocations([fields.location]);
    }
  } catch (err) {
    // Unreadable or the model is down: keep the file, unparsed.
    reportError("[board resume] parse failed", candidateId, err);
  }

  const { data, error } = await admin.rpc("attach_board_resume", {
    p_candidate_id: candidateId,
    p_path: path,
    p_content: content,
    p_fields: fields as Json,
  });
  const result = data as { ok: boolean; reason?: string; applications?: { id: string; job_post_id: string | null }[] } | null;
  if (error || !result?.ok) {
    await admin.storage.from(RESUME_BUCKET).remove([path]);
    if (result?.reason === "has_resume") return "has_resume";
    reportError("[board resume] attach failed", candidateId, error?.message ?? result?.reason);
    return "failed";
  }

  try {
    await requeueScreenings(admin, { companyId, applications: result.applications ?? [], requestedBy: null });
  } catch (err) {
    reportError("[board resume] couldn't queue the re-screens", candidateId, err);
  }
  return "attached";
}
