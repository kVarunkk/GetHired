import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/utils/types/database.types";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { reportError } from "@/helpers/posthog/report-error";
import { RESUME_FILE_SIZE_ERROR, RESUME_MAX_FILE_BYTES } from "@/helpers/resume/config";
import { ResumeParseError, parseResumeUpload, type ParsedResumeUpload } from "@/helpers/resume/parse-resume";
import { updateUserEmbedding } from "@/helpers/user/update-user-embedding";
import { PostHogEvent, TAICredits } from "@/utils/types";
import { RESUME_LIMIT_ERROR, hasRoomForResume } from "./resume-limit";

export type ResumeUploadOptions = {
  /** The resume's name. Defaults to the file's name without its extension. */
  name?: string;
  makePrimary?: boolean;
  /** Overwrites this resume of the user's instead of adding one (RE-REQ-021). */
  replaceResumeId?: string;
};

export type ResumeUploadResult = { ok: true; resumeId: string } | { ok: false; error: string };

const RESUME_GONE_ERROR = "That resume is no longer available.";

const fail = (error: string): ResumeUploadResult => ({ ok: false, error });

const fileNameToResumeName = (fileName: string) => fileName.replace(/\.(pdf|docx)$/i, "");

const parsedColumns = (parsed: ParsedResumeUpload, name: string) => ({
  name,
  schema_version: 2,
  content: parsed.content as unknown as Json,
  contact: parsed.contact as unknown as Json,
  parse_notes: parsed.parseNotes,
  parsing_failed: false,
  updated_at: new Date().toISOString(),
});

/** Credits are charged after the save, and a failed charge never fails the upload (RE-REQ-018). */
async function charge(supabase: SupabaseClient<Database>, userId: string) {
  try {
    const charged = await deductUserCreditsHelper(supabase, userId, TAICredits.AI_SEARCH_ASK_AI_RESUME);
    if (!charged.success) reportError("[RESUME_UPLOAD_CHARGE_FAILED]:", charged.error);
  } catch (error) {
    reportError("[RESUME_UPLOAD_CHARGE_FAILED]:", error);
  }
}

/**
 * A file to a saved resume, in the request (RE-REQ-010, RE-REQ-011). The file
 * is never stored. Shared by the upload action, onboarding and the claim flow;
 * `supabase` is the user's client and `user` comes from the session.
 */
export async function resumeFromUpload(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  file: File,
  { name, makePrimary = false, replaceResumeId }: ResumeUploadOptions = {},
): Promise<ResumeUploadResult> {
  if (file.size === 0) return fail("Choose a file to upload.");
  if (file.size > RESUME_MAX_FILE_BYTES) return fail(RESUME_FILE_SIZE_ERROR);

  const { data: profile } = await supabase.from("user_info").select("ai_credits").eq("user_id", user.id).single();
  if (!profile) return fail("User profile not found. Please complete your profile to upload a resume.");
  if ((profile.ai_credits || 0) < TAICredits.AI_SEARCH_ASK_AI_RESUME) {
    return fail("Insufficient AI credits for resume upload. Please top up to continue.");
  }

  if (!replaceResumeId && !(await hasRoomForResume(supabase, user.id))) return fail(RESUME_LIMIT_ERROR);

  const started = Date.now();
  let parsed: ParsedResumeUpload;
  try {
    parsed = await parseResumeUpload(new Uint8Array(await file.arrayBuffer()), { fileName: file.name });
  } catch (error) {
    if (error instanceof ResumeParseError) return fail(error.message);
    throw error;
  }
  const durationMs = Date.now() - started;

  const columns = parsedColumns(parsed, name ?? fileNameToResumeName(file.name));
  let resumeId: string;
  let isPrimary = makePrimary;

  if (replaceResumeId) {
    const { data: existing, error: readError } = await supabase
      .from("resumes")
      .select("revision")
      .eq("id", replaceResumeId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (readError) throw new Error(`Failed to read the resume: ${readError.message}`);
    if (!existing) return fail(RESUME_GONE_ERROR);

    // The revision goes up so an editor still open on the old text can't save
    // over the new file (RE-REQ-033).
    const { data, error } = await supabase
      .from("resumes")
      .update({ ...columns, revision: existing.revision + 1 })
      .eq("id", replaceResumeId)
      .eq("user_id", user.id)
      .eq("revision", existing.revision)
      .select("id, is_primary")
      .maybeSingle();
    if (error) throw new Error(`Failed to save the resume: ${error.message}`);
    if (!data) return fail(RESUME_GONE_ERROR);
    resumeId = data.id;
    isPrimary = data.is_primary;
  } else {
    const { data, error } = await supabase
      .from("resumes")
      .insert({ ...columns, user_id: user.id, is_primary: false })
      .select("id")
      .single();
    if (error) return fail("We couldn't save this resume. Please try again.");
    resumeId = data.id;

    if (makePrimary) {
      const { error: clearError } = await supabase.from("resumes").update({ is_primary: false }).eq("user_id", user.id);
      if (clearError) throw new Error(`Failed to set the primary resume: ${clearError.message}`);
      const { error: setError } = await supabase
        .from("resumes")
        .update({ is_primary: true })
        .eq("id", resumeId)
        .eq("user_id", user.id);
      if (setError) throw new Error(`Failed to set the primary resume: ${setError.message}`);
    }
  }

  await charge(supabase, user.id);

  after(async () => {
    if (isPrimary) {
      const embedded = await updateUserEmbedding(user.id);
      if (embedded.error) reportError("[RESUME_UPLOAD_EMBED_FAILED]:", embedded.error);
    }
    await eventCaptureServer({
      event: PostHogEvent.ResumeParsed,
      distinctId: user.id,
      properties: {
        duration_ms: durationMs,
        file_type: parsed.fileType,
        section_count: parsed.content.sections.length,
        coverage: parsed.coverage,
        fallback_used: parsed.fallbackUsed,
      },
    });
  });

  return { ok: true, resumeId };
}
