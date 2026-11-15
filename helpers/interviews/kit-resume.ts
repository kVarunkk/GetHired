import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applicationResume } from "@/helpers/applications/application-resume";
import { RESUME_BUCKET } from "@/helpers/candidates/resume-files";
import type { ResumeDocument } from "@/helpers/resume/render/document";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/utils/types/database.types";

// The candidate's resume in the interview kit (IVT-019, IV-REQ-034). A panel
// member may have no `applicants.view`, so the file is read with the service
// role, but only after `can_open_interview_kit` passed for the session user.
// The kit never gets a storage path or the contact snapshot.

/** How long the kit's link to a resume file works. */
export const KIT_RESUME_URL_SECONDS = 5 * 60;

export type KitResume = { kind: "document"; document: ResumeDocument } | { kind: "file" } | null;

type Source = {
  resume_snapshot?: unknown;
  linked_resume_path?: string | null;
  linked_resume_content?: unknown;
  linked_resume_template?: string | null;
  resume_path?: string | null;
  candidate_resume_path?: string | null;
};

type FileRef = { bucket: string; path: string };

async function source(userClient: SupabaseClient<Database>, interviewId: string): Promise<Source | null> {
  const { data: allowed, error } = await userClient.rpc("can_open_interview_kit", { p_interview_id: interviewId });
  if (error) throw new Error(`Couldn't check the interview kit: ${error.message}`);
  if (allowed !== true) return null;
  const { data, error: srcError } = await createServiceRoleClient().rpc("interview_resume_source", {
    p_interview_id: interviewId,
  });
  if (srcError) throw new Error(`Couldn't load the resume: ${srcError.message}`);
  return (data as Source | null) ?? null;
}

/** The applicant's file, then an older application's own file, then the imported one. */
function fileOf(src: Source): FileRef | null {
  if (src.linked_resume_path) return { bucket: "resumes", path: src.linked_resume_path };
  if (src.resume_path) return { bucket: "resumes", path: src.resume_path };
  if (src.candidate_resume_path) return { bucket: RESUME_BUCKET, path: src.candidate_resume_path };
  return null;
}

/**
 * What the kit shows: the applicant's resume document (no contact details),
 * or that there's a file behind `/api/interviews/[id]/resume`, or nothing.
 * Null too when the session user can't open the kit.
 */
export async function loadKitResume(userClient: SupabaseClient<Database>, interviewId: string): Promise<KitResume> {
  const src = await source(userClient, interviewId);
  if (!src) return null;
  const resume = applicationResume({
    // No contact snapshot is passed, so the document has no contact details.
    resume_snapshot: src.resume_snapshot,
    resumes: src.linked_resume_path || src.linked_resume_content
      ? {
          resume_path: src.linked_resume_path ?? null,
          content: src.linked_resume_content,
          template: src.linked_resume_template ?? null,
        }
      : null,
  });
  if (resume?.kind === "document") return { kind: "document", document: resume.document };
  return fileOf(src) ? { kind: "file" } : null;
}

/**
 * A short-lived signed URL to the resume file, or null when the session user
 * can't open the kit or there's no file.
 */
export async function signKitResume(userClient: SupabaseClient<Database>, interviewId: string): Promise<string | null> {
  const src = await source(userClient, interviewId);
  const file = src && fileOf(src);
  if (!file) return null;
  const { data, error } = await createServiceRoleClient()
    .storage.from(file.bucket)
    .createSignedUrl(file.path, KIT_RESUME_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(`Couldn't sign the resume: ${error?.message ?? "no URL"}`);
  return data.signedUrl;
}
