import {
  createCandidateResumeUploadAction,
  uploadCandidateResumeAction,
} from "@/app/actions/candidates/upload-candidate-resume";
import type { CandidateResumeWarning } from "@/helpers/candidates/parse-candidate-resume";
import { RESUME_BUCKET, resumeFileError } from "@/helpers/candidates/resume-files";
import { createClient } from "@/lib/supabase/client";

export type CandidateResumeUploadOutcome =
  | { ok: true; warnings: CandidateResumeWarning[]; rescreened: number }
  | { ok: false; error: string };

/**
 * BI-REQ-008 in the browser: signs an upload in the candidate's folder,
 * sends the file straight to Storage, then has the server read it into the
 * candidate. Shared by the resume section and the add-candidate form.
 */
export async function uploadCandidateResume(candidateId: string, file: File): Promise<CandidateResumeUploadOutcome> {
  const fileError = resumeFileError(file);
  if (fileError) return { ok: false, error: fileError };

  const signed = await createCandidateResumeUploadAction({
    candidateId,
    file: { name: file.name.slice(0, 255), size: file.size, type: file.type || undefined },
  });
  if (!signed.ok) return signed;

  const { error } = await createClient().storage.from(RESUME_BUCKET).uploadToSignedUrl(signed.path, signed.token, file);
  if (error) return { ok: false, error: "Couldn't upload the file. Try again." };

  const result = await uploadCandidateResumeAction({ candidateId, path: signed.path });
  // An entitlement error carries its own message.
  if (!("ok" in result)) return { ok: false, error: result.error.message };
  return result;
}
